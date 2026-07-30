import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';
import { processVideoTranslation } from '../services/video-translate.js';
import { rt } from '../services/realtime.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOAD_DIR } from './upload.js';

export const videoTranslateRouter = new Hono<Env>();

// Active jobs map to prevent duplicate processing
const activeJobs = new Map<string, Promise<void>>();

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']);
const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_LOGO_SIZE = 10 * 1024 * 1024; // 10MB

const VIDEO_TRANSLATE_DIR = join(UPLOAD_DIR, 'video-translate');
const LOGO_DIR = join(UPLOAD_DIR, 'logos');
if (!existsSync(VIDEO_TRANSLATE_DIR)) {
  try { mkdirSync(VIDEO_TRANSLATE_DIR, { recursive: true }); } catch { /* ignore */ }
}
if (!existsSync(LOGO_DIR)) {
  try { mkdirSync(LOGO_DIR, { recursive: true }); } catch { /* ignore */ }
}

/**
 * Resolve a stored path or /uploads/... URL to an absolute filesystem path.
 * Also resolves the special /api/video-translate/default-logo URL to the
 * built-in Sleiz Vietsub default logo PNG.
 * Allows the frontend to send any of these forms.
 */
function resolveStoragePath(input: string): string {
  if (!input) return input;
  if (isAbsolute(input) && existsSync(input)) return input;
  if (input === '/api/video-translate/default-logo') {
    const defaultLogo = join(process.cwd(), 'data', 'storage', 'logo-sleiz-default.png');
    if (existsSync(defaultLogo)) return defaultLogo;
  }
  if (input.startsWith('/uploads/')) {
    const rel = input.slice('/uploads/'.length);
    return join(UPLOAD_DIR, rel);
  }
  return input;
}

/**
 * Resolve an absolute filesystem path back to a /uploads/... URL when possible.
 */
function toStorageUrl(absPath: string): string | null {
  if (!absPath) return null;
  if (!isAbsolute(absPath)) return absPath;
  const normalized = absPath.replace(/\\/g, '/');
  const uploadNorm = UPLOAD_DIR.replace(/\\/g, '/');
  if (normalized.startsWith(uploadNorm)) {
    return '/uploads/' + normalized.slice(uploadNorm.length).replace(/^\/+/, '');
  }
  return null;
}

// Serve the built-in default Sleiz Vietsub logo. MUST be declared before
// /:id so Hono's pattern matcher picks this route, not the dynamic param.
videoTranslateRouter.get('/default-logo', (c) => {
  const candidate = join(process.cwd(), 'data', 'storage', 'logo-sleiz-default.png');
  if (!existsSync(candidate)) {
    return c.json({ error: 'NotFound', message: 'Default logo not generated yet.' }, 404);
  }
  const file = Bun.file(candidate);
  return new Response(file, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
});

// Probe video metadata (dimensions, duration, fps, codec). Used by the
// frontend to render accurate preview overlays (crop box, logo position,
// blur region) on top of the HTML5 video element.
videoTranslateRouter.post('/probe', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { videoPath?: string };
  if (!body.videoPath) {
    return c.json({ error: 'ValidationError', message: 'videoPath là bắt buộc' }, 400);
  }
  const abs = resolveStoragePath(body.videoPath);
  if (!existsSync(abs)) {
    return c.json({ error: 'ValidationError', message: `File video không tồn tại: ${body.videoPath}` }, 400);
  }
  try {
    const { getVideoMetadata } = await import('@sleiz/video-processor');
    const meta = await getVideoMetadata(abs);
    return c.json({
      ok: true,
      data: {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        fps: meta.fps,
        codec: meta.codec,
        audioCodec: meta.audioCodec,
        bitrate: meta.bitrate,
        aspectRatio: meta.aspectRatio,
        // Convenience: is it already 16:9?
        isAlready16x9: Math.abs(meta.width / meta.height - 16 / 9) < 0.01,
      },
    });
  } catch (err) {
    return c.json({
      error: 'ProbeError',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// Serve an arbitrary absolute file path as a video stream. This is used by
// the frontend to preview TikTok-downloaded videos (which live outside
// /uploads, in the tiktok storage dir) without having to re-upload them.
//
// Security: only serves files whose path starts with a known storage root
// (UPLOAD_DIR, STORAGE_DIR, or data/storage). This prevents arbitrary file
// reads. Range requests are supported for video seeking.
videoTranslateRouter.get('/serve', (c) => {
  const rawPath = c.req.query('path') || '';
  if (!rawPath) return c.json({ error: 'ValidationError', message: 'path là bắt buộc' }, 400);

  // Decode and normalize the path
  const decoded = decodeURIComponent(rawPath);
  const abs = isAbsolute(decoded) ? decoded : resolveStoragePath(decoded);

  // Security: only allow files inside known storage roots
  const allowedRoots = [
    UPLOAD_DIR,
    process.env.STORAGE_DIR || '',
    join(process.cwd(), 'data', 'storage'),
    join(process.cwd(), 'db', 'storage'),
  ].filter(Boolean);
  const normalizedAbs = abs.replace(/\\/g, '/');
  const isAllowed = allowedRoots.some((root) => {
    const normRoot = root.replace(/\\/g, '/');
    return normalizedAbs.startsWith(normRoot);
  });
  if (!isAllowed) {
    return c.json({ error: 'Forbidden', message: 'Path nằm ngoài thư mục lưu trữ cho phép' }, 403);
  }
  if (!existsSync(abs)) {
    return c.json({ error: 'NotFound', message: `File không tồn tại: ${abs}` }, 404);
  }

  const file = Bun.file(abs);
  const size = file.size;
  const range = c.req.header('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const start = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    const end = Math.min(requestedEnd, size - 1);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': file.type || 'video/mp4',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }
  return new Response(file, {
    headers: {
      'Content-Type': file.type || 'video/mp4',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// List all video translation jobs
videoTranslateRouter.get('/', (c) => {
  const db = c.get('db');
  const movieId = c.req.query('movieId');
  const episodeId = c.req.query('episodeId');
  
  let query = db.select().from(schema.videoTranslationJobs);
  
  if (movieId) {
    query = query.where(eq(schema.videoTranslationJobs.movieId, movieId)) as any;
  } else if (episodeId) {
    query = query.where(eq(schema.videoTranslationJobs.episodeId, episodeId)) as any;
  }
  
  const jobs = query.all();
  
  return c.json({ 
    data: jobs.map(job => ({
      ...job,
      settings: JSON.parse(job.settings || '{}'),
      metadata: JSON.parse(job.metadata || '{}'),
      originalVideoUrl: toStorageUrl(job.originalVideoPath),
      outputVideoUrl: toStorageUrl(job.outputVideoPath || ''),
      thumbnailUrl: toStorageUrl(job.thumbnailPath || ''),
    }))
  });
});

// Get single job
videoTranslateRouter.get('/:id', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  return c.json({ 
    data: {
      ...job,
      settings: JSON.parse(job.settings || '{}'),
      metadata: JSON.parse(job.metadata || '{}'),
      isProcessing: activeJobs.has(id),
      originalVideoUrl: toStorageUrl(job.originalVideoPath),
      extractedAudioUrl: toStorageUrl(job.extractedAudioPath || ''),
      originalSrtUrl: null,
      translatedSrtUrl: null,
      ttsAudioUrl: toStorageUrl(job.ttsAudioPath || ''),
      outputVideoUrl: toStorageUrl(job.outputVideoPath || ''),
      thumbnailUrl: toStorageUrl(job.thumbnailPath || ''),
    }
  });
});

// Upload a video file for translation. Returns a path that can be passed
// to POST /api/video-translate as videoPath.
videoTranslateRouter.post('/upload-video', async (c) => {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'ValidationError', message: 'Content-Type phải là multipart/form-data.' }, 400);
  }
  try {
    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'ValidationError', message: 'Thiếu file (field name: "file")' }, 400);
    }
    const ext = extname(file.name || '').toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      return c.json({ error: 'ValidationError', message: `Định dạng không hỗ trợ: ${ext}. Chọn MP4/MOV/MKV/WEBM/M4V/AVI.` }, 400);
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_SIZE) {
      return c.json({ error: 'ValidationError', message: `Video phải > 0 và <= 2GB.` }, 413);
    }
    const storedName = `${randomUUID()}${ext}`;
    const fullPath = join(VIDEO_TRANSLATE_DIR, storedName);
    await Bun.write(fullPath, await file.arrayBuffer());
    const url = `/uploads/video-translate/${storedName}`;
    return c.json({
      ok: true,
      data: {
        url,
        absolutePath: fullPath,
        fileName: file.name,
        storedName,
        size: file.size,
      },
    }, 201);
  } catch (err) {
    return c.json({
      error: 'UploadError',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// Upload a logo image (PNG recommended for transparency).
videoTranslateRouter.post('/upload-logo', async (c) => {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'ValidationError', message: 'Content-Type phải là multipart/form-data.' }, 400);
  }
  try {
    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'ValidationError', message: 'Thiếu file (field name: "file")' }, 400);
    }
    const ext = extname(file.name || '').toLowerCase();
    if (!LOGO_EXTENSIONS.has(ext)) {
      return c.json({ error: 'ValidationError', message: `Định dạng logo không hỗ trợ: ${ext}. Chọn PNG/JPG/WEBP.` }, 400);
    }
    if (file.size <= 0 || file.size > MAX_LOGO_SIZE) {
      return c.json({ error: 'ValidationError', message: 'Logo phải > 0 và <= 10MB.' }, 413);
    }
    const storedName = `${randomUUID()}${ext}`;
    const fullPath = join(LOGO_DIR, storedName);
    await Bun.write(fullPath, await file.arrayBuffer());
    const url = `/uploads/logos/${storedName}`;
    return c.json({
      ok: true,
      data: { url, absolutePath: fullPath, fileName: file.name, storedName, size: file.size },
    }, 201);
  } catch (err) {
    return c.json({
      error: 'UploadError',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// Create new video translation job
videoTranslateRouter.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  
  const {
    videoPath,
    movieId,
    episodeId,
    voice = 'BV074_streaming',
    logoPath,
    cropTo16x9 = true,
    blurIntensity = 20,
    logoPosition = 'top-right',
    logoScale = 0.15,
    // Audio controls
    ttsSpeed = 1.0,            // 0.5–2.0, applied to TTS speech via FFmpeg atempo
    ttsVolume = 1.0,           // 0.0–3.0, applied to TTS speech via FFmpeg volume
    originalAudioMode = 'replace', // 'replace' (mute original) | 'mix' (keep original at lower volume)
    originalAudioVolume = 0.0, // 0.0–1.0, only used when mode='mix'
  } = body as {
    videoPath: string;
    movieId?: string;
    episodeId?: string;
    voice?: string;
    logoPath?: string;
    cropTo16x9?: boolean;
    blurIntensity?: number;
    logoPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    logoScale?: number;
    ttsSpeed?: number;
    ttsVolume?: number;
    originalAudioMode?: 'replace' | 'mix';
    originalAudioVolume?: number;
  };

  if (!videoPath) {
    return c.json({ error: 'ValidationError', message: 'videoPath là bắt buộc' }, 400);
  }

  // Clamp audio params into safe ranges
  const safeTtsSpeed = Math.max(0.5, Math.min(2.0, Number(ttsSpeed) || 1.0));
  const safeTtsVolume = Math.max(0, Math.min(3.0, Number(ttsVolume) || 1.0));
  const safeOrigVol = Math.max(0, Math.min(1.0, Number(originalAudioVolume) || 0));
  const safeOrigMode = originalAudioMode === 'mix' ? 'mix' : 'replace';

  // Resolve /uploads/... URL → absolute filesystem path for the worker.
  const resolvedVideoPath = resolveStoragePath(videoPath);
  if (!existsSync(resolvedVideoPath)) {
    return c.json({ error: 'ValidationError', message: `File video không tồn tại: ${videoPath}` }, 400);
  }
  const resolvedLogoPath = logoPath ? resolveStoragePath(logoPath) : undefined;
  if (resolvedLogoPath && !existsSync(resolvedLogoPath)) {
    return c.json({ error: 'ValidationError', message: `File logo không tồn tại: ${logoPath}` }, 400);
  }

  const id = uuid();
  const now = Math.floor(Date.now() / 1000);

  const settings = {
    voice,
    logoPath: resolvedLogoPath,
    cropTo16x9,
    blurIntensity,
    logoPosition,
    logoScale,
    ttsSpeed: safeTtsSpeed,
    ttsVolume: safeTtsVolume,
    originalAudioMode: safeOrigMode,
    originalAudioVolume: safeOrigVol,
  };
  
  db.insert(schema.videoTranslationJobs)
    .values({
      id,
      movieId: movieId || null,
      episodeId: episodeId || null,
      originalVideoPath: resolvedVideoPath,
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      totalSteps: 7,
      settings: JSON.stringify(settings),
      metadata: '{}',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  
  rt.created('video_translation_jobs', id, { movieId, episodeId });
  
  return c.json({ data: { id, status: 'queued' } }, 201);
});

// Start processing a job
videoTranslateRouter.post('/:id/start', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  if (activeJobs.has(id)) {
    return c.json({ data: { id, running: true } }, 202);
  }
  
  // Start processing in background
  const processingPromise = processVideoTranslation(db, id)
    .catch((error) => {
      console.error(`[video-translate] Job ${id} failed:`, error);
      
      // Update job status to failed
      db.update(schema.videoTranslationJobs)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(schema.videoTranslationJobs.id, id))
        .run();
      
      rt.updated('video_translation_jobs', id, { movieId: job.movieId, episodeId: job.episodeId });
    })
    .finally(() => {
      activeJobs.delete(id);
    });
  
  activeJobs.set(id, processingPromise);
  
  // Update status to processing
  db.update(schema.videoTranslationJobs)
    .set({
      status: 'processing',
      currentStep: 'extracting_audio',
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.videoTranslationJobs.id, id))
    .run();
  
  rt.updated('video_translation_jobs', id, { movieId: job.movieId, episodeId: job.episodeId });
  
  return c.json({ data: { id, running: true } }, 202);
});

// Get job progress/status
videoTranslateRouter.get('/:id/status', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  return c.json({
    data: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      totalSteps: job.totalSteps,
      isProcessing: activeJobs.has(id),
      error: job.error,
      outputVideoPath: job.outputVideoPath,
      outputVideoUrl: job.outputVideoPath ? toStorageUrl(job.outputVideoPath) : null,
      thumbnailPath: job.thumbnailPath,
      thumbnailUrl: job.thumbnailPath ? toStorageUrl(job.thumbnailPath) : null,
    },
  });
});

// Cancel/stop a job
videoTranslateRouter.post('/:id/cancel', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  // Update status to cancelled
  db.update(schema.videoTranslationJobs)
    .set({
      status: 'failed',
      error: 'Cancelled by user',
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.videoTranslationJobs.id, id))
    .run();
  
  // Note: We can't actually stop the background job once started
  // This just marks it as cancelled in the database
  
  rt.updated('video_translation_jobs', id, { movieId: job.movieId, episodeId: job.episodeId });
  
  return c.json({ data: { id, cancelled: true } });
});

// Delete a job
videoTranslateRouter.delete('/:id', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  // Don't allow deleting active jobs
  if (activeJobs.has(id)) {
    return c.json({ error: 'Cannot delete active job. Cancel it first.' }, 400);
  }
  
  db.delete(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .run();
  
  rt.deleted('video_translation_jobs', id, { movieId: job.movieId, episodeId: job.episodeId });
  
  return c.json({ ok: true });
});

// Retry a failed job
videoTranslateRouter.post('/:id/retry', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, id))
    .get();
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  if (job.status !== 'failed') {
    return c.json({ error: 'Only failed jobs can be retried' }, 400);
  }
  
  // Reset job status
  db.update(schema.videoTranslationJobs)
    .set({
      status: 'queued',
      progress: 0,
      currentStep: 'queued',
      error: null,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.videoTranslationJobs.id, id))
    .run();
  
  rt.updated('video_translation_jobs', id, { movieId: job.movieId, episodeId: job.episodeId });
  
  return c.json({ data: { id, status: 'queued' } });
});
