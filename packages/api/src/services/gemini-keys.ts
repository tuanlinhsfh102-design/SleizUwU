/**
 * @sleiz/api / services / gemini-keys
 *
 * Multi-key rotation for Google Gemini API keys.
 *
 * The user can paste multiple Gemini API keys (one per line) in the Settings
 * page. They are stored as a JSON string in `settings.gemini_api_keys`. At
 * call time, this module picks a key using round-robin, with a simple circuit
 * breaker: a key that recently returned 429 / 5xx is parked for 60s.
 *
 * Fallback order:
 *   1.healthy keys from `geminiApiKeys` array (round-robin)
 *   2.single `geminiApiKey` (legacy field)
 *   3.`process.env.GEMINI_API_KEY`
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@sleiz/database';
import { schema } from '@sleiz/database';

interface KeyState {
  key: string;
  healthy: boolean;
  parkedUntil: number; // epoch ms; 0 = healthy
  usedCount: number;
}

const stateByKey = new Map<string, KeyState>();
let rrCursor = 0;

/** Parse the raw DB value (JSON string or newline/comma-separated) into an array. */
export function parseGeminiKeys(raw: string | null | undefined): string[] {
  if (!raw) return [];
  // Try JSON first (canonical format)
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s).trim()).filter(Boolean);
    }
  } catch {
    /* fall through to delimiter split */
  }
  // Fallback: split on newlines or commas (legacy / hand-edited)
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Load keys from DB, hydrate state, return the array of currently-stored keys. */
export function loadGeminiKeys(db: DB): string[] {
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return [];
  const keys = parseGeminiKeys(row.geminiApiKeys);
  // Always include the legacy single key if the array is empty — keeps
  // existing installs working.
  if (keys.length === 0 && row.geminiApiKey) {
    return [row.geminiApiKey];
  }
  // Hydrate state for any new keys
  for (const k of keys) {
    if (!stateByKey.has(k)) {
      stateByKey.set(k, { key: k, healthy: true, parkedUntil: 0, usedCount: 0 });
    }
  }
  // Drop state for keys that were removed
  for (const existing of stateByKey.keys()) {
    if (!keys.includes(existing)) stateByKey.delete(existing);
  }
  return keys;
}

/**
 * Pick the next healthy Gemini API key using round-robin. Falls back to env
 * var if no keys are configured.
 */
export function pickGeminiKey(db: DB): string {
  const keys = loadGeminiKeys(db);
  const now = Date.now();

  // Promote any parked keys whose timeout has elapsed back to healthy.
  for (const st of stateByKey.values()) {
    if (!st.healthy && st.parkedUntil > 0 && now >= st.parkedUntil) {
      st.healthy = true;
      st.parkedUntil = 0;
    }
  }

  const pool = keys.filter((k) => stateByKey.get(k)?.healthy);
  // Do not immediately reuse a parked key. The translation job will wait for
  // its cooldown (or select another healthy key) instead of hammering Gemini.
  if (keys.length > 0 && pool.length === 0) {
    return '';
  }
  if (pool.length === 0) {
    return process.env.GEMINI_API_KEY || '';
  }

  rrCursor = rrCursor % pool.length;
  const picked = pool[rrCursor];
  rrCursor = (rrCursor + 1) % pool.length;
  const st = stateByKey.get(picked);
  if (st) st.usedCount += 1;
  return picked;
}

/** Mark a specific key as failed (e.g. 429 / 5xx) so it gets parked for 60s. */
export function markGeminiKeyFailed(key: string, parkMs = 60_000): void {
  const st = stateByKey.get(key);
  if (!st) return;
  st.healthy = false;
  st.parkedUntil = Date.now() + parkMs;
}

/** Error signatures that mean the key itself is permanently unusable (not a transient 429/5xx). */
const PERMANENT_KEY_ERROR = /PERMISSION_DENIED|API_KEY_INVALID|"code":\s*403|\b403\b.*denied/i;

export function isPermanentKeyError(message: string | null | undefined): boolean {
  return !!message && PERMANENT_KEY_ERROR.test(message);
}

/**
 * Permanently remove a key from `geminiApiKeys` (and clear the legacy single
 * `geminiApiKey` field if it matches) — used when the key comes back with a
 * permission/invalid-key error rather than a transient rate limit.
 */
export function removeGeminiKey(db: DB, key: string): void {
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return;

  const remaining = parseGeminiKeys(row.geminiApiKeys).filter((k) => k !== key);
  const patch: Partial<typeof schema.settings.$inferInsert> = {
    geminiApiKeys: JSON.stringify(remaining),
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (row.geminiApiKey === key) {
    patch.geminiApiKey = '';
  }
  db.update(schema.settings).set(patch).where(eq(schema.settings.id, 'default')).run();
  stateByKey.delete(key);
}

/** Pretty-print a key for the UI (mask all but first 8 + last 4 chars). */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Returns a debug snapshot for the Settings page / health endpoint. */
export function getKeysDebug() {
  return Array.from(stateByKey.values()).map((s) => ({
    masked: maskKey(s.key),
    healthy: s.healthy,
    parkedUntil: s.parkedUntil,
    usedCount: s.usedCount,
  }));
}
