import { patchBunV8Snapshot } from '../../api/src/bun-patches.ts';
patchBunV8Snapshot();

import { createDb, schema, eq } from '../src/index.ts';

const db = createDb({ url: process.env.DATABASE_URL || '../../data/sleiz.db' });
const s = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();

if (s) {
  const patch: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (!s.mongodbUri && process.env.MONGODB_URI) patch.mongodbUri = process.env.MONGODB_URI;
  if (!s.githubPrivateRepo && process.env.GITHUB_PRIVATE_REPO) {
    patch.githubPrivateRepo = process.env.GITHUB_PRIVATE_REPO;
  }
  if (!s.githubPrivateToken && process.env.GITHUB_PRIVATE_TOKEN) {
    patch.githubPrivateToken = process.env.GITHUB_PRIVATE_TOKEN;
  }
  if (!s.updateAssetName) patch.updateAssetName = process.env.UPDATE_ASSET_NAME || 'win-x64';
  if (Object.keys(patch).length > 1) {
    db.update(schema.settings).set(patch).where(eq(schema.settings.id, 'default')).run();
  }
}

const updated = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
console.log({
  hasMongo: !!updated?.mongodbUri,
  repo: updated?.githubPrivateRepo,
  hasToken: !!updated?.githubPrivateToken,
  asset: updated?.updateAssetName,
});

const mongoUri = updated?.mongodbUri || process.env.MONGODB_URI || '';
if (mongoUri) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    console.log('mongo ping ok');
  } catch (err) {
    console.error('mongo ping failed', err instanceof Error ? err.message : err);
  } finally {
    await client.close();
  }
}

const repo = updated?.githubPrivateRepo || process.env.GITHUB_PRIVATE_REPO || '';
const token = updated?.githubPrivateToken || process.env.GITHUB_PRIVATE_TOKEN || '';
const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Sleiz-Studio-Updater',
  },
});
console.log('github release status', res.status, 'repo', repo);
if (res.ok) {
  const j = (await res.json()) as { tag_name?: string; assets?: Array<{ name: string }> };
  console.log({ tag: j.tag_name, assets: (j.assets || []).map((a) => a.name) });
} else {
  console.log(await res.text());
}
