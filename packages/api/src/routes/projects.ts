import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';

export const projectsRouter = new Hono<Env>();

projectsRouter.get('/', (c) => {
  const db = c.get('db') as DB;
  const rows = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
  return c.json({ data: rows.map(rowToProject) });
});

projectsRouter.get('/:id', (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.projects).where(eq(schema.projects.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToProject(row) });
});

projectsRouter.post('/', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.projects)
    .values({
      id,
      name: body.name,
      movieId: body.movieId ?? null,
      episodeId: body.episodeId ?? null,
      description: body.description ?? null,
      version: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  return c.json({ data: rowToProject(created!) }, 201);
});

projectsRouter.patch('/:id', async (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  const existing = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {
    updatedAt: Math.floor(Date.now() / 1000),
    version: (existing.version || 1) + 1,
  };
  for (const k of ['name', 'movieId', 'episodeId', 'description', 'status']) {
    if (k in body) updates[k] = body[k];
  }
  db.update(schema.projects).set(updates).where(eq(schema.projects.id, id)).run();
  const updated = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  return c.json({ data: rowToProject(updated!) });
});

projectsRouter.delete('/:id', (c) => {
  const db = c.get('db') as DB;
  const id = c.req.param('id');
  db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  return c.json({ ok: true });
});

function rowToProject(r: typeof schema.projects.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    movieId: r.movieId,
    episodeId: r.episodeId,
    description: r.description,
    version: r.version,
    status: r.status,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
