import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { schema } from '@sleiz/database';
import { uuid } from '@sleiz/shared';
import { parseSubtitle } from '@sleiz/subtitle';
import { TranslationMemoryStore } from '@sleiz/translator';
import type { Env } from '../index.js';
import { translateSubtitle } from '../services/translate.js';
import { generateDescription } from '../services/ai.js';
import { addHistory } from '../services/history.js';
import { syncMovieWorkspaceToMongo } from '../services/mongo.js';
import { rt } from '../services/realtime.js';

export const subtitlesRouter = new Hono<Env>();
const activeTranslationJobs = new Map<string, Promise<void>>();
const activeTranslationControllers = new Map<string, AbortController>();

// List
subtitlesRouter.get('/', (c) => {
  const db = c.get('db');
  const episodeId = c.req.query('episodeId');
  if (!episodeId) return c.json({ data: [] });
  const rows = db.select().from(schema.subtitles).where(eq(schema.subtitles.episodeId, episodeId)).all();
  return c.json({ data: rows.map(rowToSubtitle) });
});

// Get one (with cues)
subtitlesRouter.get('/:id', (c) => {
  const db = c.get('db');
  const row = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, c.req.param('id'))).get();
  if (!row) return c.json({ error: 'NotFound' }, 404);
  return c.json({ data: rowToSubtitle(row) });
});

// Import from raw content
subtitlesRouter.post('/import', async (c) => {
  const db = c.get('db');
  const body = await c.req.json();
  const { episodeId, content, filename, language } = body as {
    episodeId: string;
    content: string;
    filename: string;
    language?: string;
  };
  if (!episodeId || !content || !filename) {
    return c.json({ error: 'ValidationError', message: 'episodeId, content, filename are required' }, 400);
  }
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get();
  if (!episode) return c.json({ error: 'ValidationError', message: 'Episode does not exist' }, 400);

  const parsed = await parseSubtitle(content, filename, { language });
  if (parsed.cues.length === 0) {
    return c.json({
      error: 'ValidationError',
      message: 'Không tìm thấy dòng phụ đề hợp lệ. JSON cần có mảng cues/subtitles/segments với thời gian và nội dung.',
    }, 400);
  }

  // An episode has one active source subtitle. Importing another file replaces
  // that source, rather than retaining invisible old sessions and their batch
  // rows in storage. Stop and wait for old detached jobs first, otherwise an
  // in-flight job can recreate stale progress while the replacement is saved.
  const previousSubtitles = db
    .select()
    .from(schema.subtitles)
    .where(eq(schema.subtitles.episodeId, episodeId))
    .all();
  for (const previous of previousSubtitles) {
    activeTranslationControllers.get(previous.id)?.abort();
  }
  await Promise.all(previousSubtitles.map((previous) => activeTranslationJobs.get(previous.id)).filter((job): job is Promise<void> => Boolean(job)));
  for (const previous of previousSubtitles) {
    await clearTranslationMemoryForSubtitle(db, previous.cues);
    db.delete(schema.batches).where(eq(schema.batches.subtitleId, previous.id)).run();
    db.delete(schema.subtitles).where(eq(schema.subtitles.id, previous.id)).run();
  }

  const id = uuid();
  const now = Math.floor(Date.now() / 1000);
  db.insert(schema.subtitles)
    .values({
      id,
      episodeId,
      format: parsed.format,
      language: parsed.language,
      cues: JSON.stringify(parsed.cues),
      sourcePath: filename,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Link episode -> subtitle + update status
  db.update(schema.episodes)
    .set({ subtitleId: id, status: 'imported', updatedAt: now })
    .where(eq(schema.episodes.id, episodeId))
    .run();

  await addHistory(db, {
    action: 'import',
    entityType: 'subtitle',
    entityId: id,
    entityName: filename,
    details: `${parsed.cues.length} cues from ${parsed.format.toUpperCase()}`,
  });

  if (episode.movieId) {
    // A JSON subtitle can be large. Let the browser receive its import result
    // immediately; the backup sync must not hold the upload UI hostage.
    void syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  }
  rt.created('subtitles', id, { episodeId, movieId: episode.movieId });
  rt.updated('episodes', episodeId, { movieId: episode.movieId });
  // Do not echo every cue back to the browser. Large JSON files can contain
  // thousands of rows; the workspace query fetches data separately when needed.
  return c.json({ data: { id, format: parsed.format, cueCount: parsed.cues.length } }, 201);
});

// Update cues (manual edit in subtitle editor)
subtitlesRouter.patch('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (Array.isArray(body.cues)) updates.cues = JSON.stringify(body.cues);
  if (body.format) updates.format = body.format;
  if (body.language) updates.language = body.language;
  db.update(schema.subtitles).set(updates).where(eq(schema.subtitles.id, id)).run();
  const updated = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  rt.updated('subtitles', id, { episodeId: existing.episodeId });
  return c.json({ data: rowToSubtitle(updated!) });
});

// Update single cue
subtitlesRouter.patch('/:id/cues/:cueId', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const cueId = c.req.param('cueId');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);
  const cues = JSON.parse(sub.cues) as Array<Record<string, unknown>>;
  const cueIdx = cues.findIndex((c) => c.id === cueId);
  if (cueIdx === -1) return c.json({ error: 'NotFound', message: 'Cue not found' }, 404);
  const body = await c.req.json();
  cues[cueIdx] = { ...cues[cueIdx], ...body };
  db.update(schema.subtitles)
    .set({ cues: JSON.stringify(cues), updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.subtitles.id, id))
    .run();
  rt.updated('subtitles', id, { episodeId: sub.episodeId });
  return c.json({ data: cues[cueIdx] });
});

// Translate entire subtitle
subtitlesRouter.post('/:id/translate', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const controller = new AbortController();
  const options = {
    provider: body.provider,
    model: body.model,
    channelId: body.channelId,
    movieId: body.movieId,
    batchSize: body.batchSize,
    signal: controller.signal,
  };
  const result = await translateSubtitle(db, id, options);
  await generateDescriptionForTranslatedSubtitle(db, id);
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  if (episode?.movieId) {
    await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  }
  rt.updated('subtitles', id, { episodeId: sub.episodeId, movieId: episode?.movieId });
  rt.updated('batches', undefined, { subtitleId: id });
  rt.updated('episodes', sub.episodeId, { movieId: episode?.movieId });
  return c.json({ data: result });
});

subtitlesRouter.post('/:id/translate/start', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);
  if (activeTranslationJobs.has(id)) {
    return c.json({ data: { subtitleId: id, running: true } }, 202);
  }

  const body = await c.req.json().catch(() => ({}));
  const controller = new AbortController();
  const options = {
    provider: body.provider,
    model: body.model,
    channelId: body.channelId,
    movieId: body.movieId,
    batchSize: body.batchSize,
    signal: controller.signal,
  };

  activeTranslationControllers.set(id, controller);
  const job = translateSubtitle(db, id, options)
    .then(async () => {
      // Reset may have detached this job while its provider request was
      // finishing. Never let that old job sync stale translation data after
      // the reset has started a new state.
      if (activeTranslationControllers.get(id) !== controller) return;
      await generateDescriptionForTranslatedSubtitle(db, id);
      const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
      if (episode?.movieId) {
        await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
      }
      rt.updated('subtitles', id, { episodeId: sub.episodeId, movieId: episode?.movieId });
      rt.updated('batches', undefined, { subtitleId: id });
      rt.updated('episodes', sub.episodeId, { movieId: episode?.movieId });
    })
    .catch((error) => {
      // The job is intentionally detached from the request. Consume its
      // rejection after the service has persisted the failed batch so an AI
      // outage cannot become an unhandled rejection and stop the API process.
      console.error(`[subtitle-translate] ${id} failed:`, error);
    })
    .finally(() => {
      // An old detached job must not clear a newer job registered for the
      // same subtitle.
      if (activeTranslationJobs.get(id) === job) activeTranslationJobs.delete(id);
      if (activeTranslationControllers.get(id) === controller) activeTranslationControllers.delete(id);
    });

  activeTranslationJobs.set(id, job);
  return c.json({ data: { subtitleId: id, running: true } }, 202);
});

async function generateDescriptionForTranslatedSubtitle(db: Env['Variables']['db'], subtitleId: string) {
  const subtitle = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!subtitle) return;

  const cues = JSON.parse(subtitle.cues) as Array<{ textTranslated?: string }>;
  if (cues.length === 0 || cues.some((cue) => !cue.textTranslated?.trim())) return;

  try {
    await generateDescription(db, subtitle.episodeId);
  } catch (error) {
    // Metadata generation must not turn an otherwise completed translation
    // into a failed job. Users can retry from the episode workspace.
    console.error(`[subtitle-description] ${subtitleId} failed:`, error);
  }
}

// Remove every translated line and all translation batch state, but keep the
// imported source cues and their timecodes intact so the subtitle can be run again.
subtitlesRouter.post('/:id/translation/reset', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);

  // Wait for an aborted detached job to finish before writing reset cues.
  // Otherwise its cancellation cleanup can persist its old in-memory cues
  // after this route has cleared them, making the previous translated count
  // appear again on the next run.
  const activeController = activeTranslationControllers.get(id);
  activeController?.abort();
  const activeJob = activeTranslationJobs.get(id);
  if (activeJob) await activeJob;
  const cues = JSON.parse(sub.cues) as Array<Record<string, unknown>>;
  const resetCues = cues.map((cue) => ({
    ...cue,
    textTranslated: '',
    status: 'pending',
  }));

  // Translation memory is persistent. Clear entries for these source lines
  // after the active job has stopped so a subsequent run cannot refill the
  // freshly cleared cues with the old cached translations.
  await clearTranslationMemoryForSubtitle(db, sub.cues);
  db.delete(schema.batches).where(eq(schema.batches.subtitleId, id)).run();
  db.update(schema.subtitles)
    .set({ cues: JSON.stringify(resetCues), updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.subtitles.id, id))
    .run();
  db.update(schema.episodes)
    .set({ status: 'pending', updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.episodes.id, sub.episodeId))
    .run();

  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  if (episode?.movieId) await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  rt.updated('subtitles', id, { episodeId: sub.episodeId, movieId: episode?.movieId });
  rt.updated('batches', undefined, { subtitleId: id });
  rt.updated('episodes', sub.episodeId, { movieId: episode?.movieId });
  return c.json({ data: { subtitleId: id, clearedCues: resetCues.length } });
});

subtitlesRouter.get('/:id/translate/status', (c) => {
  const db = c.get('db');
  const subtitleId = c.req.param('id');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);

  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  const rows = db.select().from(schema.batches).where(eq(schema.batches.subtitleId, subtitleId)).all();
  const total = rows.length;
  const completed = rows.filter((row) => row.status === 'completed').length;
  const failed = rows.filter((row) => row.status === 'failed').length;

  return c.json({
    data: {
      subtitleId,
      running: activeTranslationJobs.has(subtitleId),
      episodeStatus: episode?.status || 'pending',
      totalBatches: total,
      completedBatches: completed,
      failedBatches: failed,
      done: total > 0 && completed === total && failed === 0,
    },
  });
});

// Delete
subtitlesRouter.delete('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, id)).get();
  if (!existing) return c.json({ error: 'NotFound' }, 404);

  // A deleted active subtitle must also be detached from its episode. Leaving
  // this pointer in place makes the workspace resolve an already-deleted
  // session and lets clients retain obsolete cues and batch state.
  activeTranslationControllers.get(id)?.abort();
  const activeJob = activeTranslationJobs.get(id);
  if (activeJob) await activeJob;
  await clearTranslationMemoryForSubtitle(db, existing.cues);
  db.delete(schema.subtitles).where(eq(schema.subtitles.id, id)).run();
  db.update(schema.episodes)
    .set({ subtitleId: null, status: 'pending', updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(schema.episodes.id, existing.episodeId), eq(schema.episodes.subtitleId, id)))
    .run();
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, existing.episodeId)).get();
  if (episode?.movieId) await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  await addHistory(db, { action: 'delete', entityType: 'subtitle', entityId: id });
  rt.deleted('subtitles', id, { episodeId: existing.episodeId, movieId: episode?.movieId });
  rt.updated('episodes', existing.episodeId, { movieId: episode?.movieId });
  return c.json({ ok: true });
});

async function clearTranslationMemoryForSubtitle(db: Env['Variables']['db'], serializedCues: string) {
  const cues = JSON.parse(serializedCues) as Array<{ textOriginal?: unknown }>;
  const sources = cues.map((cue) => typeof cue.textOriginal === 'string' ? cue.textOriginal : '');
  await new TranslationMemoryStore(db).clearForSources(sources);
}

function rowToSubtitle(r: typeof schema.subtitles.$inferSelect) {
  return {
    id: r.id,
    episodeId: r.episodeId,
    format: r.format,
    language: r.language,
    cues: JSON.parse(r.cues),
    sourcePath: r.sourcePath,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
