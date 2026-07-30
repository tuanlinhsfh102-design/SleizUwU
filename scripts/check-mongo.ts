/**
 * Check what's in the MongoDB Atlas snapshot — does the user have any backup data?
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI =
  'mongodb://truongvusleiz_db_user:machi123@ac-xau6wpk-shard-00-00.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-01.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-02.0wfigjw.mongodb.net:27017/' +
  '?ssl=true&replicaSet=atlas-11uz7a-shard-0&authSource=admin&appName=Cluster0';

const SNAPSHOT_ID = 'desktop-state';
const SNAPSHOT_TABLES = [
  'settings', 'channels', 'movies', 'episodes', 'subtitles', 'batches',
  'glossary', 'characters', 'translation_memory', 'history', 'projects',
  'ai_descriptions', 'jobs',
] as const;

async function main() {
  const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 15_000,
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    console.log('[1] Connecting to MongoDB Atlas...');
    await client.connect();
    console.log('[1] ✓ Connected');

    const db = client.db();

    // List all collections
    console.log('\n[2] All collections in this DB:');
    const collections = await db.listCollections().toArray();
    if (collections.length === 0) {
      console.log('    (no collections)');
    } else {
      for (const c of collections) {
        const count = await db.collection(c.name).countDocuments();
        console.log(`    ${c.name}: ${count} doc(s)`);
      }
    }

    // Look for the snapshot
    console.log('\n[3] Looking for sleiz_database_snapshots collection...');
    const snap = await db.collection('sleiz_database_snapshots').findOne({ _id: SNAPSHOT_ID });
    if (!snap) {
      console.log('    X No snapshot found with _id =', SNAPSHOT_ID);
      console.log('    -> This means the API server has NEVER successfully synced to MongoDB.');
      return;
    }

    console.log('    OK Snapshot found!');
    console.log('    savedAt:', snap.savedAt);
    console.log('    version:', snap.version);
    console.log('\n[4] Row counts per table in snapshot:');
    if (!snap.tables) {
      console.log('    X Snapshot has no "tables" field - corrupted or empty.');
      return;
    }
    for (const table of SNAPSHOT_TABLES) {
      const rows = (snap.tables as Record<string, unknown[]>)[table] || [];
      console.log(`    ${table}: ${rows.length} row(s)`);
      if (rows.length > 0 && table === 'channels') {
        console.log('       samples:', JSON.stringify(rows.slice(0, 2).map((r) => ({ id: (r as { id?: string }).id, name: (r as { name?: string }).name }))));
      }
      if (rows.length > 0 && table === 'movies') {
        console.log('       samples:', JSON.stringify(rows.slice(0, 2).map((r) => ({ id: (r as { id?: string }).id, titleVi: (r as { titleVi?: string }).titleVi }))));
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
