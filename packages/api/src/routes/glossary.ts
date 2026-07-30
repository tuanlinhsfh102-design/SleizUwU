import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { GlossaryEntry, GlossaryInput } from '@sleiz/shared';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import { rt } from '../services/realtime.js';

export const glossaryRouter = new Hono<Env>();

glossaryRouter.get('/', (c) => {
  const db = c.get('db');
  const channelId = c.req.query('channelId');
  const movieId = c.req.query('movieId');
  const rows = db.select().from(schema.glossary).all();
  let filtered = rows;
  if (channelId) filtered = filtered.filter((r) => r.channelId === channelId);
  if (movieId) filtered = filtered.filter((r) => r.movieId === movieId || r.movieId === null);
  return c.json({ data: filtered.map(rowToGlossary) });
});

glossaryRouter.post('/', async (c) => {
  const db = c.get('db');
  const body = (await c.req.json()) as GlossaryInput;
  if (!body.original || !body.translated) {
    return c.json({ error: 'ValidationError', message: 'original and translated are required' }, 400);
  }
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.glossary)
    .values({
      id,
      channelId: body.channelId ?? null,
      movieId: body.movieId ?? null,
      original: body.original,
      translated: body.translated,
      type: body.type || 'other',
      pinyin: body.pinyin ?? null,
      note: body.note ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  await addHistory(db, { action: 'create', entityType: 'glossary', entityId: id, entityName: body.original });
  const created = db.select().from(schema.glossary).where(eq(schema.glossary.id, id)).get();
  rt.created('glossary', id, { channelId: body.channelId, movieId: body.movieId });
  return c.json({ data: rowToGlossary(created!) }, 201);
});

glossaryRouter.post('/bulk', async (c) => {
  const db = c.get('db');
  const body = (await c.req.json()) as { entries: GlossaryInput[] };
  const now = Math.floor(Date.now() / 1000);
  const inserted: GlossaryEntry[] = [];
  for (const e of body.entries || []) {
    if (!e.original || !e.translated) continue;
    const id = uuid();
    db.insert(schema.glossary)
      .values({
        id,
        channelId: e.channelId ?? null,
        movieId: e.movieId ?? null,
        original: e.original,
        translated: e.translated,
        type: e.type || 'other',
        pinyin: e.pinyin ?? null,
        note: e.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = db.select().from(schema.glossary).where(eq(schema.glossary.id, id)).get();
    if (created) inserted.push(rowToGlossary(created));
  }
  if (inserted.length) rt.updated('glossary');
  return c.json({ data: inserted, count: inserted.length });
});

glossaryRouter.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.glossary).where(eq(schema.glossary.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const k of ['original', 'translated', 'type', 'pinyin', 'note', 'channelId', 'movieId']) {
    if (k in body) updates[k] = body[k];
  }
  db.update(schema.glossary).set(updates).where(eq(schema.glossary.id, id)).run();
  const updated = db.select().from(schema.glossary).where(eq(schema.glossary.id, id)).get();
  rt.updated('glossary', id, { channelId: existing.channelId, movieId: existing.movieId });
  return c.json({ data: rowToGlossary(updated!) });
});

glossaryRouter.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.glossary).where(eq(schema.glossary.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  db.delete(schema.glossary).where(eq(schema.glossary.id, id)).run();
  rt.deleted('glossary', id, { channelId: existing.channelId, movieId: existing.movieId });
  return c.json({ ok: true });
});

function rowToGlossary(r: typeof schema.glossary.$inferSelect): GlossaryEntry {
  return {
    id: r.id,
    channelId: r.channelId,
    movieId: r.movieId,
    original: r.original,
    translated: r.translated,
    type: r.type as GlossaryEntry['type'],
    pinyin: r.pinyin,
    note: r.note,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
