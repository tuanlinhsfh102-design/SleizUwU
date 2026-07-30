import { Hono } from 'hono';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';
import { UPLOAD_DIR } from './upload.js';
import { renderTranslatedVideo, type RenderVideoOptions } from '../services/video-render.js';
import { rt } from '../services/realtime.js';

export const mediaRouter = new Hono<Env>();

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

mediaRouter.post('/video', async (c) => {
  const db = c.get('db') as DB;
  if (!(c.req.header('content-type') || '').includes('multipart/form-data')) {
    return c.json({ error: 'ValidationError', message: 'Content-Type phải là multipart/form-data.' }, 400);
  }
  try {
    const form = await c.req.formData();
    const episodeId = typeof form.get('episodeId') === 'string' ? String(form.get('episodeId')) : '';
    const file = form.get('file') as File | null;
    const episode = episodeId ? db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get() : null;
    if (!episode) return c.json({ error: 'ValidationError', message: 'Tập phim không hợp lệ.' }, 400);
    if (!file || typeof file.arrayBuffer !== 'function') return c.json({ error: 'ValidationError', message: 'Thiếu video (field "file").' }, 400);
    const ext = extname(file.name || '').toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) return c.json({ error: 'ValidationError', message: 'Chỉ nhận MP4, MOV, MKV, WEBM hoặc M4V.' }, 400);
    if (file.size <= 0 || file.size > MAX_VIDEO_SIZE) return c.json({ error: 'ValidationError', message: 'Video phải lớn hơn 0 và không quá 2 GB.' }, 413);
    const folder = join(UPLOAD_DIR, 'media', episodeId);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const storedName = `${randomUUID()}${ext}`;
    await Bun.write(join(folder, storedName), await file.arrayBuffer());
    const url = `/uploads/media/${episodeId}/${storedName}`;
    db.update(schema.episodes).set({ videoPath: url, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.episodes.id, episodeId)).run();
    rt.updated('episodes', episodeId, { movieId: episode.movieId });
    return c.json({ data: { url, fileName: file.name, size: file.size } }, 201);
  } catch (error) {
    return c.json({ error: 'UploadError', message: error instanceof Error ? error.message : String(error) }, 500);
  }
});

mediaRouter.post('/render', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json().catch(() => ({})) as Partial<RenderVideoOptions>;
  if (!body.episodeId || !body.subtitleId) return c.json({ error: 'ValidationError', message: 'Cần chọn video và phụ đề.' }, 400);
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, body.episodeId)).get();
  const subtitle = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, body.subtitleId)).get();
  if (!episode || !subtitle || subtitle.episodeId !== episode.id) return c.json({ error: 'ValidationError', message: 'Video hoặc phụ đề không hợp lệ.' }, 400);
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  const options: RenderVideoOptions = {
    episodeId: body.episodeId,
    subtitleId: body.subtitleId,
    audioMode: body.audioMode === 'replace' ? 'replace' : 'duck',
    ttsEngine: body.ttsEngine || 'revid',
    model: body.model,
    voice: body.voice || 'vi-VN-HoaiMyNeural',
    watermarkText: body.watermarkText || 'Sleiz Vietsub',
    bgVolume: body.bgVolume ?? 0.12,
  };
  db.insert(schema.jobs).values({ id, type: 'render_video', status: 'queued', payload: JSON.stringify(options), progress: 0, total: 0, createdAt: now, updatedAt: now }).run();
  rt.created('jobs', id, { episodeId: episode.id });
  queueMicrotask(() => {
    renderTranslatedVideo(db, id, options).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const status = db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, id)).get()?.status;
      if (status !== 'cancelled') {
        db.update(schema.jobs).set({ status: 'failed', error: message, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(schema.jobs.id, id)).run();
        rt.updated('jobs', id);
      }
    });
  });
  return c.json({ data: { id, status: 'queued' } }, 202);
});