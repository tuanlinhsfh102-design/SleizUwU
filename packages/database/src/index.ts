/**
 * Database connection layer.
 * Uses Bun's built-in SQLite via drizzle-orm/bun-sqlite (no native compile needed).
 */
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = BunSQLiteDatabase<typeof schema>;

let _db: DB | null = null;
let _sqlite: Database | null = null;

export interface CreateDBOptions {
  url?: string;
  /** Run inline schema bootstrap on startup. Default: true. */
  migrate?: boolean;
  /** Create parent directory for the db file if missing. Default: true. */
  mkdir?: boolean;
}

/**
 * Normalize a database URL into a plain filesystem path.
 *
 * Accepts all common SQLite URL forms:
 *   - `file:./data/sleiz.db`        → `./data/sleiz.db`
 *   - `file:data/sleiz.db`          → `data/sleiz.db`
 *   - `file:/abs/path/sleiz.db`     → `/abs/path/sleiz.db`   (keep leading /)
 *   - `file:///abs/path/sleiz.db`   → `/abs/path/sleiz.db`   (strip // then keep /)
 *   - `sqlite://./data/sleiz.db`    → `./data/sleiz.db`
 *   - `sqlite:///abs/path/sleiz.db` → `/abs/path/sleiz.db`
 *   - `./data/sleiz.db`             → `./data/sleiz.db`  (no scheme)
 *   - `/abs/path/sleiz.db`          → `/abs/path/sleiz.db`
 *
 * On Windows, drive-letter paths (e.g. `C:\Users\...`) are preserved
 * whether or not they carry a `file:` prefix. The previous regex only
 * stripped `sqlite://`, which left `file:./data/sleiz.db` intact and
 * caused `mkdirSync('file:./data')` to fail with ENOENT.
 *
 * Key rules for the slash after the scheme:
 *   - `file:`  + relative path  → strip nothing more (`file:./data` → `./data`)
 *   - `file:`  + `/abs/path`    → keep the single `/` (it's an absolute path)
 *   - `file:`  + `//host/path`  → strip the `//` (file:// host form, rare for SQLite)
 *   - `file:`  + `///abs/path`  → strip `//`, keep `/abs/path`
 */
function normalizeDbPath(url: string): string {
  let s = url.trim();

  // 1. Strip the scheme prefix (file:, sqlite:, sqlite3:).
  const schemeMatch = s.match(/^(file|sqlite3?):/i);
  if (schemeMatch) {
    s = s.slice(schemeMatch[0].length);
  }

  // 2. Strip a leading "//" (file:// host form) but NOT a single "/"
  //    (which would be a Unix absolute path we want to preserve).
  if (s.startsWith('//')) {
    s = s.slice(2);
  }

  // 3. On Windows, a leading `/C:/...` (from `file:///C:/...` after step 2
  //    leaves `/C:/...`) needs to become `C:/...` so Node's fs APIs accept
  //    it. Match /<drive>: or \<drive>: at the start.
  s = s.replace(/^[/\\]([a-zA-Z]:[\\/])/, '$1');

  return s || './data/sleiz.db';
}

/**
 * Create (or return the cached) Drizzle database handle.
 * Safe to call repeatedly from anywhere in the process.
 */
export function createDb(opts: CreateDBOptions = {}): DB {
  if (_db) return _db;

  const url = opts.url || process.env.DATABASE_URL || './data/sleiz.db';
  const path = normalizeDbPath(url);

  if (opts.mkdir !== false) {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  _sqlite = new Database(path);
  _sqlite.exec('PRAGMA journal_mode = WAL;');
  _sqlite.exec('PRAGMA foreign_keys = ON;');
  _sqlite.exec('PRAGMA synchronous = NORMAL;');
  _sqlite.exec('PRAGMA busy_timeout = 5000;');

  _db = drizzle(_sqlite, { schema });

  if (opts.migrate !== false) {
    _sqlite.exec(SCHEMA_SQL);
  }

  ensureSchemaColumns(_sqlite);
  ensureDefaultSettings(_db);

  return _db;
}

/** Return the raw bun:sqlite instance (rarely needed). */
export function getRaw(): Database | null {
  return _sqlite;
}

/** Close the database (mostly for tests / graceful shutdown). */
export function closeDb(): void {
  try {
    _sqlite?.close();
  } catch {
    /* ignore */
  }
  _db = null;
  _sqlite = null;
}

export { schema, eq };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureDefaultSettings(db: DB): void {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).all();
  if (existing.length === 0) {
    db.insert(schema.settings).values({ id: 'default' }).onConflictDoNothing().run();
  }

  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return;

  applySettingsMigrations(db, row);
}

/**
 * Re-apply settings migrations after an external write (e.g. restore from
 * MongoDB snapshot). The snapshot may contain stale values like an old
 * GitHub repo name — calling this re-runs the migrations and overwrites
 * them with the canonical values.
 *
 * Safe to call multiple times; no-ops when settings are already canonical.
 */
export function reapplySettingsMigrations(db: DB): void {
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return;
  applySettingsMigrations(db, row);
}

function applySettingsMigrations(db: DB, row: typeof schema.settings.$inferSelect): void {
  const patch: Partial<typeof schema.settings.$inferInsert> = {};
  if (!row.mongodbUri && process.env.MONGODB_URI) {
    patch.mongodbUri = process.env.MONGODB_URI;
  }

  // Auto-migrate stale githubPrivateRepo values from old project names to the
  // canonical repo. Without this, every MongoDB restore brings back the old
  // "SleizDichPro" / "SleizAppVipUwU" value, which makes /api/updates/check
  // hit a non-existent repo and fall through to the public fallback.
  const LEGACY_REPOS = new Set([
    'tuanlinhsfh102-design/SleizDichPro',
    'tuanlinhsfh102-design/SleizAppVipUwU',
    'SleizDichPro',
    'SleizAppVipUwU',
    'owner/repo', // placeholder default from .env.example
  ]);
  const CORRECT_REPO = process.env.GITHUB_PRIVATE_REPO || 'tuanlinhsfh102-design/SleizUwU';
  if (!row.githubPrivateRepo || LEGACY_REPOS.has(row.githubPrivateRepo)) {
    patch.githubPrivateRepo = CORRECT_REPO;
  }

  // Auto-replace stale/placeholder tokens with the real one from env. Old
  // snapshots may contain "ghp_xxx" (the .env.example placeholder) which
  // passes the Boolean(token) check but is rejected by GitHub with 401.
  const LEGACY_TOKENS = new Set(['ghp_xxx', 'your-token', '']);
  const envToken = process.env.GITHUB_PRIVATE_TOKEN || '';
  if (envToken && (!row.githubPrivateToken || LEGACY_TOKENS.has(row.githubPrivateToken))) {
    patch.githubPrivateToken = envToken;
  }
  if (!row.updateAssetName) {
    patch.updateAssetName = process.env.UPDATE_ASSET_NAME || 'win-x64';
  }

  if (Object.keys(patch).length > 0) {
    db.update(schema.settings)
      .set({ ...patch, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(schema.settings.id, 'default'))
      .run();
  }
}

function ensureSchemaColumns(sqlite: Database): void {
  const statements = [
    "ALTER TABLE settings ADD COLUMN mongodb_uri TEXT",
    "ALTER TABLE settings ADD COLUMN github_private_repo TEXT",
    "ALTER TABLE settings ADD COLUMN github_private_token TEXT",
    "ALTER TABLE settings ADD COLUMN update_asset_name TEXT",
    "ALTER TABLE settings ADD COLUMN download_path TEXT",
    "ALTER TABLE settings ADD COLUMN download_concurrency INTEGER NOT NULL DEFAULT 3",
    "ALTER TABLE settings ADD COLUMN gemini_api_keys TEXT",
    "ALTER TABLE settings ADD COLUMN groq_api_key TEXT",
    "ALTER TABLE settings ADD COLUMN revid_api_key TEXT",
    "ALTER TABLE settings ADD COLUMN tiktok_session_id TEXT",
    "ALTER TABLE channels ADD COLUMN description TEXT",
    `CREATE TABLE IF NOT EXISTS video_translation_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      episode_id TEXT,
      movie_id TEXT,
      original_video_path TEXT NOT NULL,
      extracted_audio_path TEXT,
      original_srt_path TEXT,
      translated_srt_path TEXT,
      tts_audio_path TEXT,
      output_video_path TEXT,
      thumbnail_path TEXT,
      status TEXT DEFAULT 'queued' NOT NULL,
      progress INTEGER DEFAULT 0 NOT NULL,
      current_step TEXT,
      total_steps INTEGER DEFAULT 7 NOT NULL,
      error TEXT,
      settings TEXT DEFAULT '{}' NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE SET NULL
    )`,
  ];

  for (const statement of statements) {
    try {
      sqlite.exec(statement);
    } catch {
      // Column already exists.
    }
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar TEXT, banner TEXT, youtube TEXT, tiktok TEXT, facebook TEXT, discord TEXT, website TEXT, email TEXT,
  donate_info TEXT, bank_name TEXT, bank_account_number TEXT, bank_account_name TEXT,
  template_description TEXT, template_hashtag TEXT, template_thumbnail TEXT,
  ai_prompt TEXT, ai_provider TEXT, ai_model TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title_vi TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  title_en TEXT, aliases TEXT, thumbnail TEXT, poster TEXT, banner TEXT,
  studio TEXT, genres TEXT, year INTEGER, country TEXT, director TEXT, author TEXT,
  description TEXT, tags TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  thumbnail TEXT, video_path TEXT, subtitle_id TEXT,
  duration INTEGER, status TEXT NOT NULL DEFAULT 'pending', metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS subtitles (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  cues TEXT NOT NULL DEFAULT '[]',
  source_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  subtitle_id TEXT NOT NULL REFERENCES subtitles(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  start_cue INTEGER NOT NULL, end_cue INTEGER NOT NULL, total_cues INTEGER NOT NULL,
  processed_cues INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT, model TEXT,
  token_input INTEGER, token_output INTEGER, cost_usd REAL, duration_ms INTEGER,
  error TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
  movie_id TEXT REFERENCES movies(id) ON DELETE CASCADE,
  original TEXT NOT NULL,
  translated TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  pinyin TEXT, note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT, gender TEXT, role TEXT, honorific TEXT, description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS translation_memory (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  target_text TEXT NOT NULL,
  provider TEXT, movie_id TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_translation_memory_hash ON translation_memory(source_hash);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT, details TEXT, metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  movie_id TEXT REFERENCES movies(id) ON DELETE SET NULL,
  episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  description TEXT, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ai_descriptions (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  title TEXT, youtube_description TEXT, introduction TEXT, highlights TEXT,
  call_to_action TEXT, donate_message TEXT, hashtags TEXT, seo_keywords TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT, error TEXT,
  progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
  started_at INTEGER, completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  default_provider TEXT NOT NULL DEFAULT 'gemini',
  default_model TEXT NOT NULL DEFAULT 'gemini-2.0-flash-exp',
  temperature REAL NOT NULL DEFAULT 0.3,
  concurrency INTEGER NOT NULL DEFAULT 3,
  max_retries INTEGER NOT NULL DEFAULT 3,
  batch_size INTEGER NOT NULL DEFAULT 100,
  gemini_api_key TEXT, gemini_api_keys TEXT, openai_api_key TEXT, claude_api_key TEXT,
  deepseek_api_key TEXT, openrouter_api_key TEXT, qwen_api_key TEXT, groq_api_key TEXT,
  theme TEXT NOT NULL DEFAULT 'dark',
  language TEXT NOT NULL DEFAULT 'vi',
  sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
  proxy TEXT, mongodb_uri TEXT, github_private_repo TEXT, github_private_token TEXT, update_asset_name TEXT, bilibili_cookie TEXT, download_path TEXT, download_concurrency INTEGER NOT NULL DEFAULT 3,
  total_tokens_used INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;
