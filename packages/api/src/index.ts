/**
 * @sleiz/api - Hono backend.
 *
 * Exports the `app` (Hono instance) for use in tests, and the `startServer`
 * function for the standalone server entrypoint.
 */

import './bun-patches.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { createDb } from '@sleiz/database';
import path from 'node:path';
import fs from 'node:fs';

import { channelsRouter } from './routes/channels.js';
import { moviesRouter } from './routes/movies.js';
import { episodesRouter } from './routes/episodes.js';
import { subtitlesRouter } from './routes/subtitles.js';
import { batchesRouter } from './routes/batches.js';
import { glossaryRouter } from './routes/glossary.js';
import { charactersRouter } from './routes/characters.js';
import { translationMemoryRouter } from './routes/translation-memory.js';
import { aiRouter } from './routes/ai.js';
import { bilibiliRouter } from './routes/bilibili.js';
import { tiktokRouter } from './routes/tiktok.js';
import { downloadsRouter } from './routes/downloads.js';
import { exportRouter } from './routes/export.js';
import { jobsRouter } from './routes/jobs.js';
import { historyRouter } from './routes/history.js';
import { statisticsRouter } from './routes/statistics.js';
import { settingsRouter } from './routes/settings.js';
import { projectsRouter } from './routes/projects.js';
import { updatesRouter } from './routes/updates.js';
import { uploadRouter, UPLOAD_DIR } from './routes/upload.js';
import { mediaRouter } from './routes/media.js';
import { videoTranslateRouter } from './routes/video-translate.js';
import { errorHandler } from './middleware/error.js';
import { isRealtimeConfigured, broadcast } from './services/realtime.js';
import { syncDatabaseToMongo } from './services/mongo.js';

export interface Env {
  Variables: {
    db: ReturnType<typeof createDb>;
  };
}

export function createApp() {
  const app = new Hono<Env>();

  // Ensure DB is initialised and attached to context
  const db = createDb();

  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  // MongoDB is the durable backup for the desktop database. Centralising this
  // here ensures every successful API write is captured, including routes
  // added in the future.
  app.use('*', async (c, next) => {
    await next();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && c.res.status < 400) {
      await syncDatabaseToMongo(db).catch((error) => {
        console.warn('[mongo] database sync failed:', error instanceof Error ? error.message : error);
      });
    }
  });

  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      // This server only ever binds to loopback (127.0.0.1), so reflecting
      // any request origin back is safe. It also covers the desktop
      // webview's custom-protocol origins (views://, app://, etc.) which
      // vary by ElectroBun version and can't all be enumerated up front.
      origin: (origin) => origin || '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposeHeaders: ['Content-Length', 'Content-Type'],
      credentials: true,
    }),
  );

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      name: 'Sleiz Studio API',
      version: '0.1.0',
      time: new Date().toISOString(),
      realtime: {
        configured: isRealtimeConfigured(),
        channel: 'sleiz:realtime',
      },
    }),
  );

  /**
   * Self-test endpoint: fires a `ping` broadcast on the realtime channel.
   * The frontend `useRealtimeSync` hook listens for these and reports
   * round-trip success back via the StatusBar indicator.
   */
  app.post('/api/realtime/ping', (c) => {
    const id = `ping-${Date.now()}`;
    broadcast('settings', 'update', id, { scope: { jobId: id } });
    return c.json({ ok: true, id, configured: isRealtimeConfigured() });
  });

  // Routes
  app.route('/api/channels', channelsRouter);
  app.route('/api/movies', moviesRouter);
  app.route('/api/episodes', episodesRouter);
  app.route('/api/subtitles', subtitlesRouter);
  app.route('/api/batches', batchesRouter);
  app.route('/api/glossary', glossaryRouter);
  app.route('/api/characters', charactersRouter);
  app.route('/api/translation-memory', translationMemoryRouter);
  app.route('/api/ai', aiRouter);
  app.route('/api/bilibili', bilibiliRouter);
  app.route('/api/tiktok', tiktokRouter);
  app.route('/api/downloads', downloadsRouter);
  app.route('/api/export', exportRouter);
  app.route('/api/jobs', jobsRouter);
  app.route('/api/history', historyRouter);
  app.route('/api/statistics', statisticsRouter);
  app.route('/api/settings', settingsRouter);
  app.route('/api/projects', projectsRouter);
  app.route('/api/updates', updatesRouter);
  app.route('/api/upload', uploadRouter);
  app.route('/api/media', mediaRouter);
  app.route('/api/video-translate', videoTranslateRouter);
  app.get('/uploads/*', async (c) => {
    const rel = c.req.path.replace(/^\/uploads\//, '').replace(/\0/g, '').replace(/\.\./g, '');
    const safe = rel.split('/').map((p) => p.replace(/[^a-zA-Z0-9._\-]/g, '')).join('/');
    const full = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(full)) return c.json({ error: 'NotFound' }, 404);
    const file = Bun.file(full);
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
          'Content-Type': file.type || 'application/octet-stream',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
    return new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  });

  app.onError(errorHandler);

  return app;
}

export const app = createApp();

export { restoreDatabaseFromMongo, syncDatabaseToMongo } from './services/mongo.js';
