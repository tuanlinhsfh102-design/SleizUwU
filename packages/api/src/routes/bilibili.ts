import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { BilibiliClient, type DownloadProgressCallback } from '@sleiz/bilibili';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { makeThrottledReporter, progressBroker } from '../services/download-progress.js';

export const bilibiliRouter = new Hono<Env>();

function makeClient(db: DB): BilibiliClient {
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const cookie = settings?.bilibiliCookie || process.env.BILIBILI_COOKIE || '';
  return new BilibiliClient({ cookie });
}

// Parse URL → metadata
bilibiliRouter.post('/parse', async (c) => {
  const db = c.get('db') as DB;
  const { url } = (await c.req.json()) as { url: string };
  if (!url) return c.json({ error: 'ValidationError', message: 'url is required' }, 400);
  const client = makeClient(db);
  let resolvedUrl = url;
  if (url.includes('b23.tv')) {
    try {
      resolvedUrl = await client.resolveShortLink(url);
    } catch {
      /* fall through with original */
    }
  }
  const parsed = client.parseUrl(resolvedUrl);
  if (!parsed) return c.json({ error: 'ParseError', message: 'Could not parse Bilibili URL' }, 400);
  if (parsed.kind === 'bv' || parsed.kind === 'av') {
    const info = await client.getVideoInfo(parsed.id, parsed.kind);
    await addHistory(db, {
      action: 'import',
      entityType: 'bilibili',
      entityId: info.bvid,
      entityName: info.title,
      details: `Parsed ${info.episodes.length} episode(s)`,
    });
    return c.json({ data: info });
  }
  if (parsed.kind === 'ss' || parsed.kind === 'ep') {
    const info = await client.getBangumiInfo(parsed.id, parsed.kind);
    await addHistory(db, {
      action: 'import',
      entityType: 'bilibili',
      entityId: String(info.seasonId || parsed.id),
      entityName: info.title,
      details: `Parsed ${info.episodes.length} episode(s)`,
    });
    return c.json({ data: info });
  }
  return c.json({ error: 'NotSupported', message: 'Unsupported Bilibili URL' }, 400);
});

// Get subtitles for a specific cid
bilibiliRouter.get('/subtitles', async (c) => {
  const db = c.get('db') as DB;
  const aid = Number(c.req.query('aid'));
  const cid = Number(c.req.query('cid'));
  if (!aid || !cid) return c.json({ error: 'ValidationError', message: 'aid and cid are required' }, 400);
  const client = makeClient(db);
  const subs = await client.getSubtitles(aid, cid);
  return c.json({ data: subs });
});

// Download a subtitle and return as SRT text
bilibiliRouter.post('/download-subtitle', async (c) => {
  const db = c.get('db') as DB;
  const { subtitleUrl } = (await c.req.json()) as { subtitleUrl: string };
  if (!subtitleUrl) return c.json({ error: 'ValidationError', message: 'subtitleUrl is required' }, 400);
  const client = makeClient(db);
  const srt = await client.downloadSubtitleAsSrt(subtitleUrl);
  await addHistory(db, {
    action: 'download',
    entityType: 'bilibili-subtitle',
    entityId: subtitleUrl,
    details: 'Downloaded subtitle as SRT',
  });
  return c.json({ data: { format: 'srt', content: srt } });
});

// Get playurl info (for download via yt-dlp etc.)
bilibiliRouter.get('/playurl', async (c) => {
  const db = c.get('db') as DB;
  const aid = Number(c.req.query('aid'));
  const cid = Number(c.req.query('cid'));
  const qn = Number(c.req.query('qn') || 80);
  if (!aid || !cid) return c.json({ error: 'ValidationError', message: 'aid and cid are required' }, 400);
  const client = makeClient(db);
  const data = await client.getPlayUrl(aid, cid, qn);
  return c.json({ data });
});

// Download video to local storage using yt-dlp + cookie
bilibiliRouter.post('/download-video', async (c) => {
  const db = c.get('db') as DB;
  const { url, bvid, filename, jobId } = (await c.req.json()) as {
    url?: string;
    bvid?: string;
    filename?: string;
    jobId?: string;
  };
  const target = url || bvid;
  if (!target) {
    return c.json({ error: 'ValidationError', message: 'url or bvid is required' }, 400);
  }
  const client = makeClient(db);

  // Get download path from settings or use default
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const baseStorageDir = settings?.downloadPath || process.env.STORAGE_DIR || getDefaultDownloadPath();

  const { mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const videoDir = join(baseStorageDir, 'bilibili', 'videos');
  await mkdir(videoDir, { recursive: true });

  // Register the job with the broker so the webview's polling hook can attach
  // before the first byte arrives. jobId is optional; we generate one when the
  // client didn't supply it so a download call without progress still works.
  const effectiveJobId = jobId || `bilibili-${bvid || Date.now()}`;
  const displayName = filename || bvid || target;
  progressBroker.start({
    jobId: effectiveJobId,
    source: 'bilibili',
    kind: 'video',
    filename: displayName,
    receivedBytes: 0,
    totalBytes: 0,
    startedAt: Date.now(),
    status: 'downloading',
  });
  const onProgress: DownloadProgressCallback = makeThrottledReporter(effectiveJobId);

  try {
    const result = await client.downloadVideo(target, videoDir, { filename, onProgress });
    progressBroker.complete(effectiveJobId, {
      filePath: result.filePath,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      mimeType: result.mimeType,
      from: result.source,
    });
    await addHistory(db, {
      action: 'download',
      entityType: 'bilibili-video',
      entityId: bvid || target,
      entityName: filename || bvid || target,
      details: `Downloaded video (${result.fileSize} bytes) in ${result.durationMs}ms`,
    });
    return c.json({ data: { ...result, jobId: effectiveJobId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Download failed';
    progressBroker.fail(effectiveJobId, message);
    return c.json({
      error: 'DownloadError',
      message,
    }, 500);
  }
});

function getDefaultDownloadPath(): string {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Admin';
    return `${userProfile}\\Downloads\\SleizVietsubDownload`;
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '~';
    return `${home}/Downloads/SleizVietsubDownload`;
  } else {
    const home = process.env.HOME || '~';
    return `${home}/Downloads/SleizVietsubDownload`;
  }
}

// Stream / serve a previously downloaded file
bilibiliRouter.get('/file', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'ValidationError', message: 'path is required' }, 400);
  const { stat } = await import('node:fs/promises');
  try {
    const stats = await stat(path);
    if (!stats.isFile()) return c.json({ error: 'NotFound' }, 404);
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(path);
    return new Response(buf, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${path.split('/').pop()}"`,
      },
    });
  } catch {
    return c.json({ error: 'NotFound' }, 404);
  }
});
