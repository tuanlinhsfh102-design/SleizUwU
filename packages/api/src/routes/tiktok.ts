import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { TiktokClient, parseTiktokUrl, type TiktokVideoInfo, type DownloadProgressCallback } from '@sleiz/tiktok';
import { FileStorage } from '@sleiz/storage';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { makeThrottledReporter, progressBroker } from '../services/download-progress.js';

export const tiktokRouter = new Hono<Env>();

function makeClient(_db: DB): TiktokClient {
  return new TiktokClient({
    proxy: process.env.HTTP_PROXY || undefined,
  });
}

function getStorage(): FileStorage {
  return new FileStorage(process.env.STORAGE_DIR || './data/storage');
}

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

// Parse URL → metadata
tiktokRouter.post('/parse', async (c) => {
  const db = c.get('db') as DB;
  const { url } = (await c.req.json()) as { url: string };
  if (!url) return c.json({ error: 'ValidationError', message: 'url is required' }, 400);

  const parsed = parseTiktokUrl(url);
  if (!parsed) {
    return c.json({ error: 'ParseError', message: 'Could not parse TikTok URL' }, 400);
  }

  const client = makeClient(db);
  let info: TiktokVideoInfo;
  try {
    info = await client.getVideoInfo(url);
  } catch (err) {
    return c.json({
      error: 'FetchError',
      message: err instanceof Error ? err.message : 'Failed to fetch video info',
    }, 502);
  }

  await addHistory(db, {
    action: 'import',
    entityType: 'tiktok',
    entityId: info.id || url,
    entityName: info.title || info.author,
    details: `Parsed TikTok video (${info.duration}s)`,
  });

  return c.json({ data: info });
});

// Download video to local storage and return the file path
tiktokRouter.post('/download', async (c) => {
  const db = c.get('db') as DB;
  const { url, filename, music, jobId } = (await c.req.json()) as {
    url: string;
    filename?: string;
    music?: boolean;
    jobId?: string;
  };
  if (!url) return c.json({ error: 'ValidationError', message: 'url is required' }, 400);

  const client = makeClient(db);

  // Get download path from settings or use default
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const baseStorageDir = settings?.downloadPath || process.env.STORAGE_DIR || getDefaultDownloadPath();
  const storage = new FileStorage(baseStorageDir);

  let info: TiktokVideoInfo;
  try {
    info = await client.getVideoInfo(url);
  } catch (err) {
    return c.json({
      error: 'FetchError',
      message: err instanceof Error ? err.message : 'Failed to fetch video info',
    }, 502);
  }

  const videoDir = 'tiktok/videos';
  const musicDir = 'tiktok/music';

  // Register the job up-front so the webview's polling hook can attach
  // listeners even before the first byte is downloaded.
  const effectiveJobId = jobId || `tiktok-${info.id || Date.now()}`;
  const displayName = filename
    || (music
      ? `tiktok-music-${info.id || 'audio'}`
      : `tiktok-${info.id || 'video'}`);
  progressBroker.start({
    jobId: effectiveJobId,
    source: 'tiktok',
    kind: music ? 'music' : 'video',
    filename: displayName,
    receivedBytes: 0,
    totalBytes: 0,
    startedAt: Date.now(),
    status: 'downloading',
  });
  const onProgress: DownloadProgressCallback = makeThrottledReporter(effectiveJobId);

  try {
    if (music) {
      const result = await client.downloadMusic(
        info,
        await storageDir(storage, musicDir, baseStorageDir),
        filename,
        onProgress,
      );
      progressBroker.complete(effectiveJobId, {
        filePath: result.filePath,
        fileSize: result.fileSize,
        durationMs: result.durationMs,
        mimeType: result.mimeType,
        from: result.source,
      });
      await addHistory(db, {
        action: 'download',
        entityType: 'tiktok-music',
        entityId: info.id,
        entityName: info.musicTitle || info.id,
        details: `Downloaded music (${result.fileSize} bytes)`,
      });
      return c.json({
        data: {
          ...result,
          jobId: effectiveJobId,
          info: {
            id: info.id,
            title: info.musicTitle || info.title,
            author: info.musicAuthor || info.author,
            duration: info.duration,
          },
        },
      });
    }

    const result = await client.downloadVideo(
      info,
      await storageDir(storage, videoDir, baseStorageDir),
      filename,
      onProgress,
    );
    progressBroker.complete(effectiveJobId, {
      filePath: result.filePath,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      mimeType: result.mimeType,
      from: result.source,
    });
    await addHistory(db, {
      action: 'download',
      entityType: 'tiktok-video',
      entityId: info.id,
      entityName: info.title || info.author,
      details: `Downloaded video (${result.fileSize} bytes) via ${result.source}`,
    });
    return c.json({
      data: {
        ...result,
        jobId: effectiveJobId,
        info: {
          id: info.id,
          title: info.title,
          author: info.author,
          duration: info.duration,
          cover: info.cover,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Download failed';
    progressBroker.fail(effectiveJobId, message);
    return c.json({
      error: 'DownloadError',
      message,
    }, 500);
  }
});

// Helper: ensure a subdirectory exists inside the storage and return its absolute path
async function storageDir(storage: FileStorage, sub: string, baseDir: string): Promise<string> {
  const { join } = await import('node:path');
  const full = join(baseDir, sub);
  await storage.ensure();
  const { mkdir } = await import('node:fs/promises');
  await mkdir(full, { recursive: true });
  return full;
}
