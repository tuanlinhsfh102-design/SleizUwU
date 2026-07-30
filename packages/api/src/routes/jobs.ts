import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Job, JobType, JobStatus } from '@sleiz/shared';
import type { Env } from '../index.js';
import { rt } from '../services/realtime.js';

export const jobsRouter = new Hono<Env>();

jobsRouter.get('/', (c) => {
  const db = c.get('db') as DB;
  const status = c.req.query('status') as JobStatus | undefined;
  const type = c.req.query('type') as JobType | undefined;
  let rows = db.select().from(schema.jobs).orderBy(desc(schema.jobs.createdAt)).all();
  if (status) rows = rows.filter((r) => r.status === status);
  if (type) rows = rows.filter((r) => r.type === type);
  const limit = Number(c.req.query('limit') || 100);
  return c.json({ data: rows.slice(0, limit).map(rowToJob) });
});

jobsRouter.get('/stats', (c) => {
  const db = c.get('db') as DB;
  const rows = db.select().from(schema.jobs).all();
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return c.json({
    data: {
      total: rows.length,
      byStatus,
      running: rows.filter((r) => r.status === 'running').length,
      queued: rows.filter((r) => r.status === 'queued').length,
      failed: rows.filter((r) => r.status === 'failed').length,
    },
  });
});

jobsRouter.get('/:id', (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToJob(row) });
});

jobsRouter.post('/', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.jobs)
    .values({
      id,
      type: body.type,
      status: 'queued',
      priority: body.priority ?? 0,
      payload: JSON.stringify(body.payload || {}),
      progress: 0,
      total: body.total ?? 0,
      maxRetries: body.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  rt.created('jobs', id);
  return c.json({ data: rowToJob(created!) }, 201);
});

jobsRouter.post('/:id/cancel', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.update(schema.jobs)
    .set({ status: 'cancelled', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.jobs.id, id))
    .run();
  rt.updated('jobs', id);
  return c.json({ ok: true });
});

jobsRouter.delete('/:id', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.delete(schema.jobs).where(eq(schema.jobs.id, id)).run();
  rt.deleted('jobs', id);
  return c.json({ ok: true });
});

function rowToJob(r: typeof schema.jobs.$inferSelect): Job {
  return {
    id: r.id,
    type: r.type as JobType,
    status: r.status as JobStatus,
    priority: r.priority,
    payload: r.payload,
    result: r.result,
    error: r.error,
    progress: r.progress,
    total: r.total,
    retryCount: r.retryCount,
    maxRetries: r.maxRetries,
    startedAt: r.startedAt ? new Date(r.startedAt * 1000).toISOString() : null,
    completedAt: r.completedAt ? new Date(r.completedAt * 1000).toISOString() : null,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
