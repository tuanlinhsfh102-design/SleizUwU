import { Hono } from 'hono';
import { eq, desc, sql } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid, slugify } from '@sleiz/shared';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { safe } from '../middleware/error.js';
import { rt } from '../services/realtime.js';

export const channelsRouter = new Hono<Env>();

// List
channelsRouter.get('/', (c) => {
  const db = c.get('db');
  const rows = db.select().from(schema.channels).orderBy(desc(schema.channels.createdAt)).all();
  return c.json({ data: rows.map(rowToChannel) });
});

// Get one
channelsRouter.get('/:id', (c) => {
  const db = c.get('db');
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound', message: 'Channel not found' }, 404);
  return c.json({ data: rowToChannel(row) });
});

// Create
channelsRouter.post('/', safe(async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'ValidationError', message: 'Tên kênh là bắt buộc' }, 400);
  }
  const id = body.id || uuid();
  const now = Math.floor(Date.now() / 1000);

  let slug = (body.slug || slugify(body.name)).trim();
  if (!slug) {
    slug = `channel-${Date.now()}`;
  }

  let suffix = 0;
  let finalSlug = slug;
  while (true) {
    const existing = db
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.slug, finalSlug))
      .get();
    if (!existing) break;
    suffix += 1;
    finalSlug = `${slug}-${suffix}`;
  }

  const row = {
    id,
    name: body.name.trim(),
    slug: finalSlug,
    description: body.description ?? null,
    avatar: body.avatar ?? null,
    banner: body.banner ?? null,
    youtube: body.youtube ?? null,
    tiktok: body.tiktok ?? null,
    facebook: body.facebook ?? null,
    discord: body.discord ?? null,
    website: body.website ?? null,
    email: body.email ?? null,
    donateInfo: body.donateInfo ?? null,
    bankName: body.bankName ?? null,
    bankAccountNumber: body.bankAccountNumber ?? null,
    bankAccountName: body.bankAccountName ?? null,
    templateDescription: body.templateDescription ?? null,
    templateHashtag: body.templateHashtag ?? null,
    templateThumbnail: body.templateThumbnail ?? null,
    aiPrompt: body.aiPrompt ?? null,
    aiProvider: body.aiProvider ?? null,
    aiModel: body.aiModel ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.channels).values(row).run();
  await addHistory(db, { action: 'create', entityType: 'channel', entityId: id, entityName: row.name });
  rt.created('channels', id);
  const created = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
  return c.json({ data: rowToChannel(created!) }, 201);
}));

// Update
channelsRouter.patch('/:id', safe(async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound', message: 'Không tìm thấy kênh' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const k of [
    'name', 'slug', 'description', 'avatar', 'banner', 'youtube', 'tiktok', 'facebook', 'discord', 'website',
    'email', 'donateInfo', 'bankName', 'bankAccountNumber', 'bankAccountName',
    'templateDescription', 'templateHashtag', 'templateThumbnail', 'aiPrompt', 'aiProvider', 'aiModel',
  ]) {
    if (k in body) updates[k] = body[k];
  }
  if ('name' in updates && typeof updates.name === 'string') {
    updates.name = String(updates.name).trim();
    if (!updates.name) {
      return c.json({ error: 'ValidationError', message: 'Tên kênh không được để trống' }, 400);
    }
    if (!('slug' in body)) {
      let baseSlug = slugify(String(updates.name));
      if (!baseSlug) baseSlug = `channel-${Date.now()}`;
      let suffix = 0;
      let finalSlug = baseSlug;
      while (true) {
        const dup = db
          .select({ id: schema.channels.id })
          .from(schema.channels)
          .where(eq(schema.channels.slug, finalSlug))
          .get();
        if (!dup || dup.id === id) break;
        suffix += 1;
        finalSlug = `${baseSlug}-${suffix}`;
      }
      updates.slug = finalSlug;
    }
  }
  if ('slug' in updates && typeof updates.slug === 'string') {
    const slugVal = String(updates.slug).trim();
    if (!slugVal) {
      return c.json({ error: 'ValidationError', message: 'Slug không được để trống' }, 400);
    }
    const dup = db
      .select({ id: schema.channels.id })
      .from(schema.channels)
      .where(eq(schema.channels.slug, slugVal))
      .get();
    if (dup && dup.id !== id) {
      return c.json({ error: 'ConflictError', message: 'Slug đã tồn tại, hãy chọn tên khác' }, 409);
    }
    updates.slug = slugVal;
  }
  db.update(schema.channels).set(updates).where(eq(schema.channels.id, id)).run();
  await addHistory(db, { action: 'update', entityType: 'channel', entityId: id, entityName: existing.name });
  rt.updated('channels', id);
  const updated = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
  return c.json({ data: rowToChannel(updated!) });
}));

// Delete
channelsRouter.delete('/:id', safe(async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound', message: 'Không tìm thấy kênh' }, 404);
  db.delete(schema.channels).where(eq(schema.channels.id, id)).run();
  await addHistory(db, { action: 'delete', entityType: 'channel', entityId: id, entityName: existing.name });
  rt.deleted('channels', id);
  return c.json({ ok: true });
}));

// Stats: counts per channel (movies, episodes, etc.)
channelsRouter.get('/:id/stats', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const movieCount = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.movies)
    .where(eq(schema.movies.channelId, id))
    .get();
  const episodeCount = db
    .select({ count: sql<number>`count(*)`, })
    .from(schema.episodes)
    .innerJoin(schema.movies, eq(schema.episodes.movieId, schema.movies.id))
    .where(eq(schema.movies.channelId, id))
    .get();
  return c.json({
    data: {
      movies: movieCount?.count ?? 0,
      episodes: episodeCount?.count ?? 0,
    },
  });
});

// ---------------------------------------------------------------------------
function rowToChannel(r: typeof schema.channels.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    avatar: r.avatar,
    banner: r.banner,
    youtube: r.youtube,
    tiktok: r.tiktok,
    facebook: r.facebook,
    discord: r.discord,
    website: r.website,
    email: r.email,
    donateInfo: r.donateInfo,
    bankName: r.bankName,
    bankAccountNumber: r.bankAccountNumber,
    bankAccountName: r.bankAccountName,
    templateDescription: r.templateDescription,
    templateHashtag: r.templateHashtag,
    templateThumbnail: r.templateThumbnail,
    aiPrompt: r.aiPrompt,
    aiProvider: r.aiProvider,
    aiModel: r.aiModel,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
