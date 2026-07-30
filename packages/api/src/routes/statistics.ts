import { Hono } from 'hono';
import { eq, sql, desc } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import type { Env } from '../index.js';

export const statisticsRouter = new Hono<Env>();

statisticsRouter.get('/', (c) => {
  const db = c.get('db') as DB;

  const channels = db.select({ count: sql<number>`count(*)` }).from(schema.channels).get()?.count ?? 0;
  const movies = db.select({ count: sql<number>`count(*)` }).from(schema.movies).get()?.count ?? 0;
  const episodes = db.select({ count: sql<number>`count(*)` }).from(schema.episodes).get()?.count ?? 0;
  const subtitles = db.select({ count: sql<number>`count(*)` }).from(schema.subtitles).get()?.count ?? 0;
  const batches = db.select({ count: sql<number>`count(*)` }).from(schema.batches).get()?.count ?? 0;
  const glossaryEntries = db.select({ count: sql<number>`count(*)` }).from(schema.glossary).get()?.count ?? 0;
  const tmEntries = db.select({ count: sql<number>`count(*)` }).from(schema.translationMemory).get()?.count ?? 0;

  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const totalTokensUsed = settings?.totalTokensUsed ?? 0;
  const totalCostUsd = settings?.totalCostUsd ?? 0;

  // Translation duration = sum of batch durationMs
  const totalDurationMs =
    db
      .select({ total: sql<number>`COALESCE(SUM(${schema.batches.durationMs}), 0)` })
      .from(schema.batches)
      .get()?.total ?? 0;

  // Today's progress: episodes translated today
  const startOfToday = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const episodesToday =
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.episodes)
      .where(sql`${schema.episodes.updatedAt} >= ${startOfToday}`)
      .get()?.count ?? 0;

  // Last 14 days of batch completions for chart
  const since = Math.floor((Date.now() - 14 * 86400 * 1000) / 1000);
  const recentBatches = db
    .select({
      day: sql<string>`date(${schema.batches.updatedAt}, 'unixepoch')`,
      tokens: sql<number>`COALESCE(SUM(${schema.batches.tokenInput} + ${schema.batches.tokenOutput}), 0)`,
      cost: sql<number>`COALESCE(SUM(${schema.batches.costUsd}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(schema.batches)
    .where(sql`${schema.batches.updatedAt} >= ${since} AND ${schema.batches.status} = 'completed'`)
    .groupBy(sql`date(${schema.batches.updatedAt}, 'unixepoch')`)
    .orderBy(sql`date(${schema.batches.updatedAt}, 'unixepoch')`)
    .all();

  // Episode status breakdown
  const episodeStatusRows = db
    .select({ status: schema.episodes.status, count: sql<number>`count(*)` })
    .from(schema.episodes)
    .groupBy(schema.episodes.status)
    .all();

  return c.json({
    data: {
      counts: {
        channels,
        movies,
        episodes,
        subtitles,
        batches,
        glossaryEntries,
        translationMemory: tmEntries,
      },
      tokens: totalTokensUsed,
      cost: totalCostUsd,
      durationMs: totalDurationMs,
      episodesToday,
      recentBatches,
      episodeStatuses: episodeStatusRows,
    },
  });
});
