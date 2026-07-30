import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import type { Env } from '../index.js';
import { pingMongo } from '../services/mongo.js';
import { rt } from '../services/realtime.js';
import { parseGeminiKeys, maskKey } from '../services/gemini-keys.js';

export const settingsRouter = new Hono<Env>();

settingsRouter.get('/', (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return c.json({ data: null });
  return c.json({ data: rowToSettings(row) });
});

/** Compute the default download path for the current OS. */
function getDefaultDownloadPath(): string {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\Admin';
    return `${userProfile}\\Downloads\\SleizVietsubDownload`;
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || '~';
    return `${home}/Downloads/SleizVietsubDownload`;
  } else {
    const home = process.env.HOME || '~';
    return `${home}/Downloads/SleizVietsubDownload`;
  }
}

settingsRouter.post('/test-mongo', async (c) => {
  const db = c.get('db') as DB;
  try {
    const result = await pingMongo(db);
    if (!result.ok) {
      return c.json({ error: 'MongoNotConfigured', message: 'Chưa cấu hình MongoDB URI' }, 400);
    }
    return c.json({ data: { ok: true } });
  } catch (err) {
    return c.json(
      { error: 'MongoPingFailed', message: err instanceof Error ? err.message : 'Ping failed' },
      502,
    );
  }
});

settingsRouter.patch('/', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) };
  const allowedKeys = [
    'defaultProvider',
    'defaultModel',
    'temperature',
    'concurrency',
    'maxRetries',
    'batchSize',
    'geminiApiKey',
    'geminiApiKeys',
    'openaiApiKey',
    'claudeApiKey',
    'deepseekApiKey',
    'openrouterApiKey',
    'qwenApiKey',
    'groqApiKey',
    'revidApiKey',
    'tiktokSessionId',
    'theme',
    'language',
    'sidebarCollapsed',
    'proxy',
    'mongodbUri',
    'githubPrivateRepo',
    'githubPrivateToken',
    'updateAssetName',
    'bilibiliCookie',
    'downloadPath',
    'downloadConcurrency',
  ];
  for (const k of allowedKeys) {
    if (k in body) {
      // sidebarCollapsed comes from frontend as boolean, store as 0/1
      if (k === 'sidebarCollapsed') {
        updates[k] = body[k] ? 1 : 0;
      } else if (k === 'geminiApiKeys') {
        // Accept either an array or a newline/comma-separated string; normalise to JSON array string.
        const raw = body[k];
        let arr: string[] = [];
        if (Array.isArray(raw)) {
          arr = raw.map((s: unknown) => String(s).trim()).filter(Boolean);
        } else if (typeof raw === 'string') {
          arr = parseGeminiKeys(raw);
        }
        updates[k] = JSON.stringify(arr);
        // Keep the legacy single-key field in sync with the first key so any
        // code path that still reads `geminiApiKey` keeps working.
        if (arr.length > 0) updates['geminiApiKey'] = arr[0];
      } else {
        updates[k] = body[k];
      }
    }
  }
  // Ensure row exists
  const existing = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!existing) {
    db.insert(schema.settings).values({ id: 'default', ...updates } as never).run();
  } else {
    db.update(schema.settings).set(updates).where(eq(schema.settings.id, 'default')).run();
  }
  const updated = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  rt.updated('settings', 'default');
  return c.json({ data: rowToSettings(updated!) });
});

function rowToSettings(r: typeof schema.settings.$inferSelect) {
  const geminiKeys = parseGeminiKeys(r.geminiApiKeys);
  // If only the legacy single key is set, expose it as a 1-element array too.
  const allKeys = geminiKeys.length > 0 ? geminiKeys : (r.geminiApiKey ? [r.geminiApiKey] : []);
  const effectiveDownloadPath = r.downloadPath || getDefaultDownloadPath();
  return {
    id: r.id,
    defaultProvider: r.defaultProvider,
    defaultModel: r.defaultModel,
    temperature: r.temperature,
    concurrency: r.concurrency,
    maxRetries: r.maxRetries,
    batchSize: r.batchSize,
    hasGeminiKey: !!r.geminiApiKey || allKeys.length > 0,
    geminiKeysCount: allKeys.length,
    // Mask each key for display — never return raw keys to the browser.
    geminiApiKeys: allKeys.map(maskKey),
    // Keep legacy field for backward compat (still masked).
    geminiApiKey: r.geminiApiKey ? '••••••••' : '',
    openaiApiKey: r.openaiApiKey ? '••••••••' : '',
    claudeApiKey: r.claudeApiKey ? '••••••••' : '',
    deepseekApiKey: r.deepseekApiKey ? '••••••••' : '',
    openrouterApiKey: r.openrouterApiKey ? '••••••••' : '',
    qwenApiKey: r.qwenApiKey ? '••••••••' : '',
    groqApiKey: r.groqApiKey ? '••••••••' : '',
    revidApiKey: r.revidApiKey ? '••••••••' : '',
    // TikTok session ID is used by the TTS provider — mask it like the other
    // secrets, but expose a boolean so the UI can show whether it's configured.
    tiktokSessionId: r.tiktokSessionId ? '••••••••' : '',
    theme: r.theme,
    language: r.language,
    sidebarCollapsed: r.sidebarCollapsed === 1,
    proxy: r.proxy,
    mongodbUri: r.mongodbUri ? '••••••••' : '',
    githubPrivateRepo: r.githubPrivateRepo,
    githubPrivateToken: r.githubPrivateToken ? '••••••••' : '',
    updateAssetName: r.updateAssetName,
    hasMongoUri: !!r.mongodbUri,
    hasGithubPrivateToken: !!r.githubPrivateToken,
    hasBilibiliCookie: !!r.bilibiliCookie,
    hasOpenaiKey: !!r.openaiApiKey,
    hasClaudeKey: !!r.claudeApiKey,
    hasDeepseekKey: !!r.deepseekApiKey,
    hasOpenrouterKey: !!r.openrouterApiKey,
    hasQwenKey: !!r.qwenApiKey,
    hasGroqKey: !!r.groqApiKey || !!process.env.GROQ_API_KEY,
    hasRevidKey: !!r.revidApiKey || !!process.env.REVID_API_KEY,
    hasTiktokSessionId: !!r.tiktokSessionId || !!process.env.TIKTOK_SESSION_ID,
    downloadPath: effectiveDownloadPath,
    downloadConcurrency: r.downloadConcurrency,
    totalTokensUsed: r.totalTokensUsed,
    totalCostUsd: r.totalCostUsd,
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
