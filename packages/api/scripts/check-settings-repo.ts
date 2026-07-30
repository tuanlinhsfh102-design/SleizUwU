/**
 * Inspect the settings row in the MongoDB snapshot to see what githubPrivateRepo
 * value is currently stored (the user's old DB likely has "SleizDichPro" from
 * before we standardized on SleizUwU).
 *
 * Usage: bun packages/api/scripts/check-settings-repo.ts
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI =
  'mongodb://truongvusleiz_db_user:machi123@ac-xau6wpk-shard-00-00.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-01.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-02.0wfigjw.mongodb.net:27017/' +
  '?ssl=true&replicaSet=atlas-11uz7a-shard-0&authSource=admin&appName=Cluster0';

const SNAPSHOT_ID = 'desktop-state';

async function main() {
  const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 15_000,
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    const snap = await client.db().collection('sleiz_database_snapshots').findOne({ _id: SNAPSHOT_ID });
    if (!snap) {
      console.log('No snapshot found.');
      return;
    }

    const settings = (snap.tables as Record<string, unknown[]>).settings?.[0] as
      | { github_private_repo?: string; mongodb_uri?: string; github_private_token?: string }
      | undefined;

    console.log('Settings row from snapshot:');
    console.log('  github_private_repo:', settings?.github_private_repo || '(empty)');
    console.log('  github_private_token (first 12 chars):', (settings?.github_private_token || '').slice(0, 12) + '...');
    console.log('  github_private_token (full length):', (settings?.github_private_token || '').length, 'chars');
    console.log('  mongodb_uri:', settings?.mongodb_uri ? '(set)' : '(empty)');
    console.log('');
    console.log('savedAt:', snap.savedAt);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
