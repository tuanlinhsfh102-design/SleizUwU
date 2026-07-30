import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import type { HistoryEntry, HistoryAction } from '@sleiz/shared';
import type { Env } from '../index.js';
import { rt } from '../services/realtime.js';

export const historyRouter = new Hono<Env>();

historyRouter.get('/', (c) => {
  const db = c.get('db') as DB;
  const action = c.req.query('action') as HistoryAction | undefined;
  const entityType = c.req.query('entityType');
  const limit = Number(c.req.query('limit') || 100);
  let rows = db.select().from(schema.history).orderBy(desc(schema.history.createdAt)).all();
  if (action) rows = rows.filter((r) => r.action === action);
  if (entityType) rows = rows.filter((r) => r.entityType === entityType);
  return c.json({ data: rows.slice(0, limit).map(rowToHistory) });
});

historyRouter.delete('/:id', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.delete(schema.history).where(eq(schema.history.id, id)).run();
  rt.deleted('history', id);
  return c.json({ ok: true });
});

historyRouter.delete('/', (c) => {
  const db = c.get('db') as DB;
  db.delete(schema.history).run();
  rt.cleared('history');
  return c.json({ ok: true });
});

function rowToHistory(r: typeof schema.history.$inferSelect): HistoryEntry {
  return {
    id: r.id,
    action: r.action as HistoryAction,
    entityType: r.entityType,
    entityId: r.entityId,
    entityName: r.entityName,
    details: r.details,
    metadata: r.metadata,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
  };
}
