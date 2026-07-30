import { Hono } from 'hono';
import { eq, desc, sql, and } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { rt } from '../services/realtime.js';

export const episodesRouter = new Hono<Env>();

episodesRouter.get('/', (c) => {
  const db = c.get('db');
  const movieId = c.req.query('movieId');
  const conditions = [];
  if (movieId) conditions.push(eq(schema.episodes.movieId, movieId));
  let query = db.select().from(schema.episodes).$dynamic();
  if (conditions.length === 1) query = query.where(conditions[0]);
  const rows = query.orderBy(sql`${schema.episodes.episodeNumber} ASC`).all();
  return c.json({ data: rows.map(rowToEpisode) });
});

episodesRouter.get('/:id', (c) => {
  const db = c.get('db');
  const row = db.select().from(schema.episodes).where(eq(schema.episodes.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToEpisode(row) });
});

episodesRouter.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const movie = db.select().from(schema.movies).where(eq(schema.movies.id, body.movieId)).get();
  if (!movie) return c.json({ error: 'ValidationError', message: 'Movie does not exist' }, 400);
  const id = body.id || uuid();
  const now = Math.floor(Date.now() / 1000);
  const row = {
    id,
    movieId: body.movieId,
    title: body.title,
    episodeNumber: body.episodeNumber,
    thumbnail: body.thumbnail ?? null,
    videoPath: body.videoPath ?? null,
    subtitleId: body.subtitleId ?? null,
    duration: body.duration ?? null,
    status: body.status || 'pending',
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.episodes).values(row).run();
  await addHistory(db, { action: 'create', entityType: 'episode', entityId: id, entityName: row.title });
  rt.created('episodes', id, { movieId: body.movieId });
  const created = db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get();
  return c.json({ data: rowToEpisode(created!) }, 201);
});

episodesRouter.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const k of [
    'movieId', 'title', 'episodeNumber', 'thumbnail', 'videoPath', 'subtitleId', 'duration', 'status',
  ]) {
    if (k in body) updates[k] = body[k];
  }
  if ('metadata' in body) updates.metadata = body.metadata ? JSON.stringify(body.metadata) : null;
  db.update(schema.episodes).set(updates).where(eq(schema.episodes.id, id)).run();
  await addHistory(db, { action: 'update', entityType: 'episode', entityId: id, entityName: existing.title });
  rt.updated('episodes', id, { movieId: existing.movieId });
  const updated = db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get();
  return c.json({ data: rowToEpisode(updated!) });
});

episodesRouter.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  db.delete(schema.episodes).where(eq(schema.episodes.id, id)).run();
  await addHistory(db, { action: 'delete', entityType: 'episode', entityId: id, entityName: existing.title });
  rt.deleted('episodes', id, { movieId: existing.movieId });
  return c.json({ ok: true });
});

function rowToEpisode(r: typeof schema.episodes.$inferSelect) {
  return {
    id: r.id,
    movieId: r.movieId,
    title: r.title,
    episodeNumber: r.episodeNumber,
    thumbnail: r.thumbnail,
    videoPath: r.videoPath,
    subtitleId: r.subtitleId,
    duration: r.duration,
    status: r.status,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
