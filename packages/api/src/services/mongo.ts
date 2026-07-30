import { eq } from 'drizzle-orm';
import { getRaw, schema, type DB } from '@sleiz/database';
import { getMovieWorkspace } from './workspace.js';
import { patchBunV8Snapshot } from '../bun-patches.js';

function resolveMongoUri(db: DB): string {
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  return settings?.mongodbUri || process.env.MONGODB_URI || '';
}

const SNAPSHOT_ID = 'desktop-state';

// Keep this list explicit: these are application tables, not SQLite internals.
// The order also respects the foreign-key relationships during restore.
const SNAPSHOT_TABLES = [
  'settings',
  'channels',
  'movies',
  'episodes',
  'subtitles',
  'batches',
  'glossary',
  'characters',
  'translation_memory',
  'history',
  'projects',
  'ai_descriptions',
  'jobs',
] as const;

type Snapshot = {
  version: 1;
  savedAt: Date;
  tables: Record<string, Record<string, unknown>[]>;
};

type SnapshotDocument = Snapshot & { _id: string };

async function getMongoClient() {
  patchBunV8Snapshot();
  const { MongoClient } = await import('mongodb');
  return MongoClient;
}

function createMongoClient(MongoClient: Awaited<ReturnType<typeof getMongoClient>>, uri: string) {
  // A desktop app must still start when Atlas is offline, blocked by a proxy,
  // or temporarily slow. The next API write will retry the backup.
  return new MongoClient(uri, {
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
  });
}

export async function syncMovieWorkspaceToMongo(db: DB, movieId: string) {
  const mongodbUri = resolveMongoUri(db);
  if (!mongodbUri) {
    return { ok: false, reason: 'missing-mongodb-uri' as const };
  }

  const workspace = getMovieWorkspace(db, movieId);
  const MongoClient = await getMongoClient();
  const client = createMongoClient(MongoClient, mongodbUri);

  try {
    await client.connect();
    const database = client.db();
    await database.collection('movie_workspaces').updateOne(
      { movieId },
      {
        $set: {
          movieId,
          syncedAt: new Date(),
          workspace,
        },
      },
      { upsert: true },
    );
    return { ok: true as const };
  } finally {
    await client.close();
  }
}

/**
 * Persist the complete local database in MongoDB. SQLite remains the fast
 * working store, while this snapshot makes data survive a replaced or wiped
 * local app-data directory.
 */
export async function syncDatabaseToMongo(db: DB) {
  const mongodbUri = resolveMongoUri(db);
  const sqlite = getRaw();
  if (!mongodbUri || !sqlite) {
    return { ok: false, reason: !mongodbUri ? 'missing-mongodb-uri' as const : 'missing-local-db' as const };
  }

  const tables: Snapshot['tables'] = {};
  for (const table of SNAPSHOT_TABLES) {
    tables[table] = sqlite.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  }

  const MongoClient = await getMongoClient();
  const client = createMongoClient(MongoClient, mongodbUri);
  try {
    await client.connect();
    await client.db().collection<SnapshotDocument>('sleiz_database_snapshots').replaceOne(
      { _id: SNAPSHOT_ID },
      { _id: SNAPSHOT_ID, version: 1, savedAt: new Date(), tables },
      { upsert: true },
    );
    return { ok: true as const };
  } finally {
    await client.close();
  }
}

/** Restore the MongoDB snapshot only when this installation has no user data. */
export async function restoreDatabaseFromMongo(db: DB) {
  const mongodbUri = resolveMongoUri(db);
  const sqlite = getRaw();
  if (!mongodbUri || !sqlite) {
    return { ok: false, reason: !mongodbUri ? 'missing-mongodb-uri' as const : 'missing-local-db' as const };
  }

  // `settings` is bootstrapped automatically, so use the domain tables to
  // distinguish a fresh installation from one that already contains data.
  const hasLocalData = SNAPSHOT_TABLES
    .filter((table) => table !== 'settings')
    .some((table) => Number((sqlite.query(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count) > 0);
  if (hasLocalData) return { ok: true as const, restored: false };

  const MongoClient = await getMongoClient();
  const client = createMongoClient(MongoClient, mongodbUri);
  try {
    await client.connect();
    const snapshot = await client.db().collection<SnapshotDocument>('sleiz_database_snapshots').findOne({ _id: SNAPSHOT_ID });
    if (!snapshot?.tables) return { ok: true as const, restored: false };

    sqlite.exec('PRAGMA foreign_keys = OFF;');
    try {
      for (const table of SNAPSHOT_TABLES) {
        const rows = snapshot.tables[table] || [];
        for (const row of rows) {
          const columns = Object.keys(row);
          if (columns.length === 0) continue;
          const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          sqlite.query(`INSERT OR REPLACE INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`).run(
            ...columns.map((column) => row[column]),
          );
        }
      }
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON;');
    }
    return { ok: true as const, restored: true };
  } finally {
    await client.close();
  }
}

export async function pingMongo(db: DB) {
  const mongodbUri = resolveMongoUri(db);
  if (!mongodbUri) {
    return { ok: false, reason: 'missing-mongodb-uri' as const };
  }

  const MongoClient = await getMongoClient();
  const client = createMongoClient(MongoClient, mongodbUri);
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    return { ok: true as const };
  } finally {
    await client.close();
  }
}
