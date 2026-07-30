import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid } from '@sleiz/shared';

function toIso(ts: number) {
  return new Date(ts * 1000).toISOString();
}

export function ensureMovieWorkspace(db: DB, movieId: string) {
  const movie = db.select().from(schema.movies).where(eq(schema.movies.id, movieId)).get();
  if (!movie) {
    throw new Error('Movie not found');
  }

  const episodes = db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.movieId, movieId))
    .all()
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  if (episodes[0]) {
    return getMovieWorkspace(db, movieId);
  }

  const now = Math.floor(Date.now() / 1000);
  const episodeId = uuid();
  db.insert(schema.episodes)
    .values({
      id: episodeId,
      movieId,
      title: movie.titleVi,
      episodeNumber: 1,
      status: 'pending',
      metadata: JSON.stringify({ kind: 'movie-workspace' }),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return getMovieWorkspace(db, movieId);
}

export function getMovieWorkspace(db: DB, movieId: string) {
  const movie = db.select().from(schema.movies).where(eq(schema.movies.id, movieId)).get();
  if (!movie) {
    throw new Error('Movie not found');
  }

  const episode = db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.movieId, movieId))
    .all()
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0] ?? null;

  const subtitle = episode?.subtitleId
    ? db.select().from(schema.subtitles).where(eq(schema.subtitles.id, episode.subtitleId)).get() ?? null
    : null;

  const description = episode
    ? db.select().from(schema.aiDescriptions).where(eq(schema.aiDescriptions.episodeId, episode.id)).get() ?? null
    : null;

  const batches = subtitle
    ? db
        .select()
        .from(schema.batches)
        .where(eq(schema.batches.subtitleId, subtitle.id))
        .all()
        .sort((a, b) => a.batchIndex - b.batchIndex)
    : [];

  return {
    movie: {
      ...movie,
      createdAt: toIso(movie.createdAt),
      updatedAt: toIso(movie.updatedAt),
    },
    episode: episode
      ? {
          ...episode,
          createdAt: toIso(episode.createdAt),
          updatedAt: toIso(episode.updatedAt),
        }
      : null,
    subtitle: subtitle
      ? {
          ...subtitle,
          cues: JSON.parse(subtitle.cues),
          createdAt: toIso(subtitle.createdAt),
          updatedAt: toIso(subtitle.updatedAt),
        }
      : null,
    description: description
      ? {
          ...description,
          createdAt: toIso(description.createdAt),
          updatedAt: toIso(description.updatedAt),
        }
      : null,
    batches: batches.map((batch) => ({
      ...batch,
      createdAt: toIso(batch.createdAt),
      updatedAt: toIso(batch.updatedAt),
    })),
  };
}
