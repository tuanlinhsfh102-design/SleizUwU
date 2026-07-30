import { Hono } from 'hono';
import { eq, desc, sql, and } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { ensureMovieWorkspace, getMovieWorkspace } from '../services/workspace.js';
import { syncMovieWorkspaceToMongo } from '../services/mongo.js';
import { safe } from '../middleware/error.js';
import { rt } from '../services/realtime.js';

export const moviesRouter = new Hono<Env>();

moviesRouter.get('/', (c) => {
  const db = c.get('db');
  const channelId = c.req.query('channelId');
  const q = c.req.query('q');
  let query = db.select().from(schema.movies).$dynamic();
  const conditions = [];
  if (channelId) conditions.push(eq(schema.movies.channelId, channelId));
  if (q) conditions.push(sql`${schema.movies.titleVi} LIKE ${`%${q}%`} OR ${schema.movies.titleZh} LIKE ${`%${q}%`}`);
  if (conditions.length === 1) query = query.where(conditions[0]);
  if (conditions.length > 1) query = query.where(and(...conditions));
  const rows = query.orderBy(desc(schema.movies.createdAt)).all();
  return c.json({ data: rows.map(rowToMovie) });
});

moviesRouter.get('/:id/workspace', (c) => {
  const db = c.get('db');
  try {
    const data = getMovieWorkspace(db, c.req.param('id'));
    return c.json({ data });
  } catch {
    return c.json({ error: 'NotFound' }, 404);
  }
});

moviesRouter.post('/:id/workspace', safe(async (c) => {
  const db = c.get('db');
  try {
    const data = ensureMovieWorkspace(db, c.req.param('id'));
    await syncMovieWorkspaceToMongo(db, c.req.param('id')).catch(() => null);
    rt.updated('workspace', c.req.param('id'), { movieId: c.req.param('id') });
    return c.json({ data });
  } catch {
    return c.json({ error: 'NotFound' }, 404);
  }
}));

moviesRouter.get('/:id', (c) => {
  const db = c.get('db');
  const row = db.select().from(schema.movies).where(eq(schema.movies.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToMovie(row) });
});

moviesRouter.post('/', safe(async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, body.channelId)).get();
  if (!channel) return c.json({ error: 'ValidationError', message: 'Channel does not exist' }, 400);
  const titleVi = typeof body.titleVi === 'string' ? body.titleVi.trim() : '';
  if (!titleVi) {
    return c.json({ error: 'ValidationError', message: 'Tên bộ phim là bắt buộc' }, 400);
  }
  const titleZh = (typeof body.titleZh === 'string' && body.titleZh.trim()) ? body.titleZh.trim() : titleVi;
  const id = body.id || uuid();
  const now = Math.floor(Date.now() / 1000);
  const imageUrl = body.poster || body.thumbnail || null;
  const row = {
    id,
    channelId: body.channelId,
    titleVi,
    titleZh,
    titleEn: body.titleEn ?? null,
    aliases: body.aliases ?? null,
    thumbnail: imageUrl,
    poster: imageUrl,
    banner: body.banner ?? null,
    studio: body.studio ?? null,
    genres: body.genres ?? null,
    year: body.year ?? null,
    country: body.country ?? null,
    director: body.director ?? null,
    author: body.author ?? null,
    description: body.description ?? null,
    tags: body.tags ?? null,
    status: body.status || 'planned',
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.movies).values(row).run();
  await addHistory(db, { action: 'create', entityType: 'movie', entityId: id, entityName: row.titleVi });
  rt.created('movies', id, { channelId: body.channelId });
  const created = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
  await syncMovieWorkspaceToMongo(db, id).catch(() => null);
  return c.json({ data: rowToMovie(created!) }, 201);
}));

moviesRouter.patch('/:id', safe(async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const k of [
    'channelId', 'titleVi', 'titleZh', 'titleEn', 'aliases', 'thumbnail', 'poster', 'banner',
    'studio', 'genres', 'year', 'country', 'director', 'author', 'description', 'tags', 'status',
  ]) {
    if (k in body) updates[k] = body[k];
  }
  if ('titleVi' in updates && typeof updates.titleVi === 'string') {
    updates.titleVi = String(updates.titleVi).trim();
    if (!updates.titleVi) {
      return c.json({ error: 'ValidationError', message: 'Tên bộ phim không được để trống' }, 400);
    }
    if (!('titleZh' in body)) {
      updates.titleZh = updates.titleVi;
    }
  }
  if ('titleZh' in updates && typeof updates.titleZh === 'string') {
    updates.titleZh = String(updates.titleZh).trim();
    if (!updates.titleZh) updates.titleZh = existing.titleZh || (existing.titleVi);
  }
  if ('poster' in updates && updates.poster && !('thumbnail' in body)) {
    updates.thumbnail = updates.poster;
  }
  db.update(schema.movies).set(updates).where(eq(schema.movies.id, id)).run();
  await addHistory(db, { action: 'update', entityType: 'movie', entityId: id, entityName: existing.titleVi });
  rt.updated('movies', id, { channelId: existing.channelId });
  const updated = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
  await syncMovieWorkspaceToMongo(db, id).catch(() => null);
  return c.json({ data: rowToMovie(updated!) });
}));

moviesRouter.delete('/:id', safe(async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  db.delete(schema.movies).where(eq(schema.movies.id, id)).run();
  await addHistory(db, { action: 'delete', entityType: 'movie', entityId: id, entityName: existing.titleVi });
  rt.deleted('movies', id, { channelId: existing.channelId });
  return c.json({ ok: true });
}));

function rowToMovie(r: typeof schema.movies.$inferSelect) {
  return {
    id: r.id,
    channelId: r.channelId,
    titleVi: r.titleVi,
    titleZh: r.titleZh,
    titleEn: r.titleEn,
    aliases: r.aliases,
    thumbnail: r.thumbnail,
    poster: r.poster,
    banner: r.banner,
    studio: r.studio,
    genres: r.genres,
    year: r.year,
    country: r.country,
    director: r.director,
    author: r.author,
    description: r.description,
    tags: r.tags,
    status: r.status,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
