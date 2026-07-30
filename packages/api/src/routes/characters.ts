import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import type { Env } from '../index.js';
import { rt } from '../services/realtime.js';

export const charactersRouter = new Hono<Env>();

charactersRouter.get('/', (c) => {
  const db = c.get('db');
  const movieId = c.req.query('movieId');
  const rows = db.select().from(schema.characters).all();
  const filtered = movieId ? rows.filter((r) => r.movieId === movieId) : rows;
  return c.json({ data: filtered.map(rowToCharacter) });
});

charactersRouter.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.characters)
    .values({
      id,
      movieId: body.movieId,
      name: body.name,
      aliases: body.aliases ?? null,
      gender: body.gender ?? null,
      role: body.role ?? null,
      honorific: body.honorific ?? null,
      description: body.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  rt.created('characters', id, { movieId: body.movieId });
  return c.json({ data: rowToCharacter(created!) }, 201);
});

charactersRouter.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  for (const k of ['name', 'aliases', 'gender', 'role', 'honorific', 'description', 'movieId']) {
    if (k in body) updates[k] = body[k];
  }
  db.update(schema.characters).set(updates).where(eq(schema.characters.id, id)).run();
  const updated = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  rt.updated('characters', id, { movieId: existing.movieId });
  return c.json({ data: rowToCharacter(updated!) });
});

charactersRouter.delete('/:id', (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  db.delete(schema.characters).where(eq(schema.characters.id, id)).run();
  rt.deleted('characters', id, { movieId: existing?.movieId });
  return c.json({ ok: true });
});

function rowToCharacter(r: typeof schema.characters.$inferSelect) {
  return {
    id: r.id,
    movieId: r.movieId,
    name: r.name,
    aliases: r.aliases,
    gender: r.gender,
    role: r.role,
    honorific: r.honorific,
    description: r.description,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
