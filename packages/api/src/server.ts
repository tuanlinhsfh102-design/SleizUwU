/**
 * Standalone Hono server (Bun runtime).
 * Run: `bun run src/server.ts` or `bun run dev` (with --watch).
 *
 * Boot flow:
 *   1. Resolve a stable absolute DB path (independent of cwd) so moving
 *      the project folder or running from different shells doesn't
 *      silently create a new empty SQLite file.
 *   2. createDb() — runs schema bootstrap + ensures default settings row.
 *   3. restoreDatabaseFromMongo() — if local DB is empty (fresh install,
 *      re-install, folder moved), pull the latest snapshot from MongoDB
 *      Atlas. Time-boxed to 12s so a slow/blocked Atlas never blocks
 *      the API from starting.
 *   4. serve() — start the Hono API.
 *
 * Shutdown flow (SIGINT/SIGTERM/SIGHUP):
 *   - One final syncDatabaseToMongo() so the last few writes after the
 *     middleware's auto-sync are captured before the process exits.
 */
import { serve } from '@hono/node-server';
import { createDb, closeDb, reapplySettingsMigrations } from '@sleiz/database';
import { isAbsolute, resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { app } from './index.js';
import { restoreDatabaseFromMongo, syncDatabaseToMongo } from './services/mongo.js';

// ---------------------------------------------------------------------------
// 1. Stable DB path — never relative to cwd
// ---------------------------------------------------------------------------
function resolveStableDatabaseUrl(): string {
  let url = process.env.DATABASE_URL || '';
  if (!url) {
    // Per-user data dir so re-downloading / moving the project folder
    // never loses data.
    const base =
      process.platform === 'win32'
        ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
        : process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support')
          : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
    const dir = join(base, 'ai.sleiz.studio', 'standalone', 'data');
    url = join(dir, 'sleiz.db');
  }
  // Strip any sqlite://, sqlite:, file://, file: prefix.
  // Keep the rest of the path intact (including a leading "/" for Unix
  // absolute paths). The previous regex /^(sqlite:\/\/|file:)/ would leave
  // `file:./data/sleiz.db` partially stripped on some platforms.
  let path = url.replace(/^(file|sqlite3?):\/{0,2}/i, '');
  // On Windows, strip a leading "/" before a drive letter (e.g. `/C:/...`
  // from `file:///C:/...` → `C:/...`) so Node's fs APIs accept it.
  path = path.replace(/^[/\\]([a-zA-Z]:[\\/])/, '$1');
  if (!isAbsolute(path)) {
    path = resolve(process.cwd(), path);
  }
  // Ensure parent dir exists so the SQLite open never fails.
  const dir = dirname(path);
  if (dir && !existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ignore — open() below will surface the error
    }
  }
  return path;
}

const dbUrl = resolveStableDatabaseUrl();
process.env.DATABASE_URL = dbUrl;
console.log(`[sleiz-api] DATABASE_URL = ${dbUrl}`);

// STORAGE_DIR also benefits from being absolute — same trick.
if (!process.env.STORAGE_DIR) {
  process.env.STORAGE_DIR = join(dirname(dbUrl), 'storage');
}

// ---------------------------------------------------------------------------
// 2. Initialise the DB
// ---------------------------------------------------------------------------
const db = createDb();

// ---------------------------------------------------------------------------
// 3. Restore from MongoDB if local DB is empty
//    Time-boxed to 12s so a slow Atlas link doesn't block startup.
// ---------------------------------------------------------------------------
let mongoRestored = false;
try {
  const result = await Promise.race([
    restoreDatabaseFromMongo(db),
    new Promise<{ timeout: true }>((r) => setTimeout(() => r({ timeout: true }), 12_000)),
  ]);
  if ('timeout' in result) {
    console.warn('[sleiz-api] MongoDB restore timed out; continuing with local data only');
  } else if (result.ok && result.restored) {
    mongoRestored = true;
    console.log('[sleiz-api] restored local DB from MongoDB snapshot');
  } else if (!result.ok) {
    console.warn(`[sleiz-api] MongoDB restore skipped: ${result.reason}`);
  } else {
    console.log('[sleiz-api] local DB already has data; skipping MongoDB restore');
  }
} catch (err) {
  console.warn('[sleiz-api] MongoDB restore failed:', err instanceof Error ? err.message : err);
}

// Re-apply settings migrations after restore — the MongoDB snapshot may
// contain stale values like an old GitHub repo name (e.g. "SleizDichPro"
// from before we standardized on "SleizUwU"). Without this re-run, every
// restore would resurrect the bad value and /api/updates/check would hit
// a non-existent repo.
try {
  reapplySettingsMigrations(db);
} catch (err) {
  console.warn('[sleiz-api] settings re-migration failed:', err instanceof Error ? err.message : err);
}

// After restore, push the (possibly merged) local state back up so Atlas
// always reflects reality. Non-blocking — API starts immediately.
void syncDatabaseToMongo(db).catch((err) => {
  console.warn('[sleiz-api] initial MongoDB sync skipped:', err instanceof Error ? err.message : err);
});

// ---------------------------------------------------------------------------
// 4. Start Hono server
// ---------------------------------------------------------------------------
const port = Number(process.env.API_PORT || 8787);
const hostname = process.env.API_HOST || '0.0.0.0';

console.log(`\n  Sleiz Studio API`);
console.log(`  → http://${hostname}:${port}/api/health\n`);
if (mongoRestored) {
  console.log(`  → data restored from MongoDB Atlas\n`);
}

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(`  Listening on http://${info.address}:${info.port}`);
  },
);

// ---------------------------------------------------------------------------
// 5. Graceful shutdown — final MongoDB sync so last writes survive
// ---------------------------------------------------------------------------
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  [sleiz-api] ${signal} received, shutting down...`);

  // Best-effort final sync. Time-boxed so a hung Atlas doesn't keep the
  // process alive forever when the user just wants to quit.
  try {
    await Promise.race([
      syncDatabaseToMongo(db),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    console.log('[sleiz-api] final MongoDB sync done');
  } catch (err) {
    console.warn('[sleiz-api] final MongoDB sync failed:', err instanceof Error ? err.message : err);
  }

  try {
    server.close();
  } catch {
    // ignore
  }
  closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
// Windows-specific: when the parent terminal is closed we get SIGBREAK,
// not SIGINT — handle it too so Vite/API child processes don't leak data.
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
