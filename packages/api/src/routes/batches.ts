import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Job, JobType, JobStatus } from '@sleiz/shared';
import type { Env } from '../index.js';
import { rt } from '../services/realtime.js';

export const batchesRouter = new Hono<Env>();

batchesRouter.get('/', (c) => {
  const db = c.get('db') as DB;
  const episodeId = c.req.query('episodeId');
  const subtitleId = c.req.query('subtitleId');
  let rows = db.select().from(schema.batches).orderBy(desc(schema.batches.createdAt)).all();
  if (episodeId) rows = rows.filter((r) => r.episodeId === episodeId);
  if (subtitleId) rows = rows.filter((r) => r.subtitleId === subtitleId);
  return c.json({ data: rows.map(rowToBatch) });
});

batchesRouter.get('/:id', (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.batches).where(eq(schema.batches.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToBatch(row) });
});

batchesRouter.post('/:id/pause', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.update(schema.batches)
    .set({ status: 'paused', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.batches.id, id))
    .run();
  rt.updated('batches', id);
  return c.json({ ok: true });
});

batchesRouter.post('/:id/resume', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.update(schema.batches)
    .set({ status: 'queued', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.batches.id, id))
    .run();
  rt.updated('batches', id);
  return c.json({ ok: true });
});

batchesRouter.post('/:id/cancel', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.update(schema.batches)
    .set({ status: 'cancelled', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.batches.id, id))
    .run();
  rt.updated('batches', id);
  return c.json({ ok: true });
});

function rowToBatch(r: typeof schema.batches.$inferSelect) {
  return {
    id: r.id,
    episodeId: r.episodeId,
    subtitleId: r.subtitleId,
    batchIndex: r.batchIndex,
    startCue: r.startCue,
    endCue: r.endCue,
    totalCues: r.totalCues,
    processedCues: r.processedCues,
    status: r.status,
    provider: r.provider,
    model: r.model,
    tokenInput: r.tokenInput,
    tokenOutput: r.tokenOutput,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    error: r.error,
    retryCount: r.retryCount,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
