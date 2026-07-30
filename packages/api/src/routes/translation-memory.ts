import { Hono } from 'hono';
import { eq, sql, desc } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { TranslationMemoryStore } from '@sleiz/translator';
import type { Env } from '../index.js';
import { rt } from '../services/realtime.js';

export const translationMemoryRouter = new Hono<Env>();

translationMemoryRouter.get('/', (c) => {
  const db = c.get('db');
  const q = c.req.query('q');
  let rows = db.select().from(schema.translationMemory).orderBy(desc(schema.translationMemory.hitCount)).all();
  if (q) {
    rows = rows.filter((r) => r.sourceText.includes(q) || r.targetText.includes(q));
  }
  const limit = Number(c.req.query('limit') || 100);
  return c.json({
    data: rows.slice(0, limit).map((r) => ({
      id: r.id,
      sourceText: r.sourceText,
      targetText: r.targetText,
      provider: r.provider,
      movieId: r.movieId,
      hitCount: r.hitCount,
      createdAt: new Date(r.createdAt * 1000).toISOString(),
      updatedAt: new Date(r.updatedAt * 1000).toISOString(),
    })),
  });
});

translationMemoryRouter.get('/stats', async (c) => {
  const db = c.get('db') as DB;
  const store = new TranslationMemoryStore(db);
  const stats = await store.stats();
  return c.json({ data: stats });
});

translationMemoryRouter.delete('/clear', (c) => {
  const db = c.get('db') as DB;
  db.delete(schema.translationMemory).run();
  rt.cleared('translation-memory');
  return c.json({ ok: true });
});

translationMemoryRouter.delete('/:id', (c) => {
  const db = c.get('db') as DB;
  db.delete(schema.translationMemory).where(eq(schema.translationMemory.id, c.req.param('id'))).run();
  rt.deleted('translation-memory', c.req.param('id'));
  return c.json({ ok: true });
});
