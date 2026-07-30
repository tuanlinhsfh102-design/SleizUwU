/**
 * One-shot migration script: copy TIKTOK_SESSION_ID and REVID_API_KEY from
 * process.env (loaded from .env) into the SQLite settings row, but only
 * if the DB row doesn't already have them. This bridges the gap between
 * .env-based config and DB-based config for the TTS providers.
 *
 * Run from the project root: `bun scripts/migrate-env-to-db.ts`
 */
import { createDb, schema } from '@sleiz/database';
import { eq } from 'drizzle-orm';

const db = createDb({ migrate: false });
const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();

console.log('Current settings row:');
console.log('  tiktokSessionId:', row?.tiktokSessionId ? row.tiktokSessionId.substring(0, 16) + '...' : 'NOT SET');
console.log('  revidApiKey:', row?.revidApiKey ? 'SET' : 'NOT SET');
console.log('  mongodbUri:', row?.mongodbUri ? 'SET' : 'NOT SET');
console.log('');
console.log('Env vars:');
console.log('  TIKTOK_SESSION_ID:', process.env.TIKTOK_SESSION_ID ? 'SET' : 'NOT SET');
console.log('  REVID_API_KEY:', process.env.REVID_API_KEY ? 'SET' : 'NOT SET');

const updates: Record<string, string> = {};
if (process.env.TIKTOK_SESSION_ID && !row?.tiktokSessionId) {
  updates.tiktokSessionId = process.env.TIKTOK_SESSION_ID;
}
if (process.env.REVID_API_KEY && !row?.revidApiKey) {
  updates.revidApiKey = process.env.REVID_API_KEY;
}
// Also backfill MongoDB URI + Supabase keys if missing — useful when the
// user has restored the DB from MongoDB but the local settings row is
// missing some fields.
if (process.env.MONGODB_URI && !row?.mongodbUri) {
  updates.mongodbUri = process.env.MONGODB_URI;
}

if (Object.keys(updates).length === 0) {
  console.log('\nNothing to migrate — all env vars already in DB (or env vars not set).');
  process.exit(0);
}

console.log('\nMigrating:', Object.keys(updates).join(', '));
db.update(schema.settings).set(updates).where(eq(schema.settings.id, 'default')).run();
console.log('Done.');

const final = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
console.log('\nFinal settings row:');
console.log('  tiktokSessionId:', final?.tiktokSessionId ? final.tiktokSessionId.substring(0, 16) + '...' : 'NOT SET');
console.log('  revidApiKey:', final?.revidApiKey ? 'SET' : 'NOT SET');
console.log('  mongodbUri:', final?.mongodbUri ? 'SET' : 'NOT SET');
