import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { schema, type DB } from '@sleiz/database';
import { SUBTITLE_TRANSLATION_SYSTEM_PROMPT, uuid, slugify, AI_PROVIDER_LABELS, AI_DEFAULT_MODELS, resolveAIModel, type AIProviderType } from '@sleiz/shared';
import { createProvider, batchTranslate, type AIProvider, type BatchTranslateResult } from '@sleiz/translator';
import { TranslationMemoryStore, loadGlossary, GlossaryReplacer } from '@sleiz/translator';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';
import {
  generateDescription,
  generateThumbnailPrompt,
  rewriteSubtitleWithAI,
  runConsistencyCheck,
  suggestMovieTitle,
} from '../services/ai.js';
import { syncMovieWorkspaceToMongo } from '../services/mongo.js';
import { pickGeminiKey, isPermanentKeyError, removeGeminiKey, maskKey } from '../services/gemini-keys.js';
import { UPLOAD_DIR } from './upload.js';

export const aiRouter = new Hono<Env>();

// List available providers
aiRouter.get('/providers', (c) => {
  return c.json({
    data: Object.entries(AI_PROVIDER_LABELS).map(([id, label]) => ({
      id,
      label,
      defaultModel: AI_DEFAULT_MODELS[id] || '',
    })),
  });
});

// Get settings (without revealing raw API keys)
aiRouter.get('/config', async (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!row) return c.json({ data: null });
  return c.json({
    data: {
      defaultProvider: row.defaultProvider,
      defaultModel: row.defaultModel,
      temperature: row.temperature,
      concurrency: row.concurrency,
      maxRetries: row.maxRetries,
      batchSize: row.batchSize,
      hasGeminiKey: !!row.geminiApiKey,
      hasOpenaiKey: !!row.openaiApiKey,
      hasClaudeKey: !!row.claudeApiKey,
      hasDeepseekKey: !!row.deepseekApiKey,
      hasOpenrouterKey: !!row.openrouterApiKey,
      hasQwenKey: !!row.qwenApiKey,
      hasGroqKey: !!row.groqApiKey || !!process.env.GROQ_API_KEY,
    },
  });
});

const GROQ_TTS_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_TTS_MODELS = new Set([
  'canopylabs/orpheus-v1-english',
  'canopylabs/orpheus-arabic-saudi',
]);
const GROQ_TTS_VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);

/** Generate a WAV file with Groq Orpheus text-to-speech and store it locally. */
aiRouter.post('/speech', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const model = typeof body.model === 'string' ? body.model : 'canopylabs/orpheus-v1-english';
  const voice = typeof body.voice === 'string' ? body.voice : 'autumn';

  if (!text) return c.json({ error: 'ValidationError', message: 'text is required' }, 400);
  // Groq Orpheus currently limits an individual generation request to 200 characters.
  if (text.length > 200) {
    return c.json({ error: 'ValidationError', message: 'Groq TTS chỉ hỗ trợ tối đa 200 ký tự mỗi lần.' }, 400);
  }
  if (!GROQ_TTS_MODELS.has(model)) {
    return c.json({ error: 'ValidationError', message: 'Groq TTS model không hợp lệ.' }, 400);
  }
  if (!GROQ_TTS_VOICES.has(voice)) {
    return c.json({ error: 'ValidationError', message: 'Groq TTS voice không hợp lệ.' }, 400);
  }

  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const apiKey = settings?.groqApiKey || process.env.GROQ_API_KEY || '';
  if (!apiKey) {
    return c.json({ error: 'NoApiKey', message: 'Chưa cấu hình Groq API key trong Settings.' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await fetch(GROQ_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, voice, input: text, response_format: 'wav' }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Groq TTS hết thời gian chờ sau 90 giây.'
      : error instanceof Error ? error.message : String(error);
    return c.json({ error: 'GroqSpeechFailed', message }, 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    return c.json({
      error: 'GroqSpeechFailed',
      message: `Groq TTS lỗi ${response.status}: ${detail.slice(0, 600)}`,
    }, response.status === 401 || response.status === 403 ? 401 : 502);
  }

  const audio = await response.arrayBuffer();
  if (audio.byteLength < 44) {
    return c.json({ error: 'GroqSpeechFailed', message: 'Groq TTS trả về audio không hợp lệ.' }, 502);
  }
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `groq-tts-${Date.now()}-${randomUUID()}.wav`;
  await Bun.write(join(UPLOAD_DIR, fileName), audio);

  return c.json({
    data: {
      audioUrl: `/uploads/${fileName}`,
      fileName,
      bytes: audio.byteLength,
      model,
      voice,
    },
  }, 201);
});

// Test translate (single line)
aiRouter.post('/translate', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { text, provider, model, channelId, movieId } = body as {
    text: string;
    provider?: AIProviderType;
    model?: string;
    channelId?: string;
    movieId?: string;
  };
  if (!text) return c.json({ error: 'ValidationError', message: 'text is required' }, 400);

  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!settings) return c.json({ error: 'SettingsNotFound' }, 500);

  const providerType = (provider || settings.defaultProvider || 'gemini') as AIProviderType;
  // For Gemini, use round-robin rotation across multiple configured keys.
  const apiKey = providerType === 'gemini'
    ? pickGeminiKey(db)
    : getApiKey(settings, providerType);
  if (!apiKey) {
    return c.json({ error: 'NoApiKey', message: `No API key configured for ${providerType}` }, 400);
  }
  const modelId = resolveAIModel(providerType, model || settings.defaultModel);

  const provider_ = createProvider({ provider: providerType, model: modelId, apiKey });

  // Glossary
  let glossary: GlossaryReplacer | undefined;
  if (channelId || movieId) {
    glossary = await loadGlossary(db, { channelId, movieId });
  }

  // Channel prompt override
  let systemPrompt = SUBTITLE_TRANSLATION_SYSTEM_PROMPT;
  if (channelId) {
    const ch = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (ch?.aiPrompt) systemPrompt = `${ch.aiPrompt}\n\n${SUBTITLE_TRANSLATION_SYSTEM_PROMPT}`;
  }
  if (glossary) systemPrompt += glossary.buildPromptBlock();

  const memory = new TranslationMemoryStore(db);
  const results = await batchTranslate([{ id: uuid(), index: 0, source: text }], {
    provider: provider_,
    systemPrompt,
    glossary,
    memory,
    movieId,
    temperature: settings.temperature,
    concurrency: 1,
  });

  const r: BatchTranslateResult = results[0];
  if (r.error) {
    // A permission/invalid-key error means the key itself is dead — drop it
    // for good instead of just parking it, so it's never picked again.
    let keyRemoved = false;
    if (providerType === 'gemini' && apiKey && isPermanentKeyError(r.error)) {
      removeGeminiKey(db, apiKey);
      keyRemoved = true;
    }
    return c.json(
      {
        error: 'TranslationFailed',
        message: r.error,
        keyRemoved,
        removedKey: keyRemoved ? maskKey(apiKey) : undefined,
      },
      500,
    );
  }
  if (r.usage) {
    db.update(schema.settings)
      .set({
        totalTokensUsed: (settings.totalTokensUsed || 0) + r.usage.totalTokens,
        totalCostUsd: (settings.totalCostUsd || 0) + r.usage.costUsd,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .run();
  }
  return c.json({
    data: {
      source: r.source,
      target: r.target,
      fromMemory: r.fromMemory,
      usage: r.usage,
      provider: providerType,
      model: modelId,
    },
  });
});

aiRouter.post('/movie-title', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json().catch(() => ({}));
  const { content, filename, currentTitle } = body as {
    content?: string;
    filename?: string;
    currentTitle?: string;
  };

  if (!content || !content.trim()) {
    return c.json({ error: 'ValidationError', message: 'content is required' }, 400);
  }

  const result = await suggestMovieTitle(db, { content, filename, currentTitle });
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (settings) {
    db.update(schema.settings)
      .set({
        totalTokensUsed: (settings.totalTokensUsed || 0) + result.usage.totalTokens,
        totalCostUsd: (settings.totalCostUsd || 0) + result.usage.costUsd,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .run();
  }
  return c.json({ data: result });
});

// Generate AI description for an episode
aiRouter.get('/description/:episodeId', async (c) => {
  const db = c.get('db') as DB;
  const row = db.select().from(schema.aiDescriptions).where(eq(schema.aiDescriptions.episodeId, c.req.param('episodeId'))).get();
  return c.json({ data: row || null });
});

aiRouter.post('/description', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { episodeId } = body as { episodeId: string };
  if (!episodeId) return c.json({ error: 'ValidationError', message: 'episodeId is required' }, 400);
  const result = await generateDescription(db, episodeId);
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get();
  if (episode?.movieId) {
    await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  }
  return c.json({ data: result });
});

// Generate thumbnail prompt
aiRouter.post('/thumbnail', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { episodeId } = body as { episodeId: string };
  if (!episodeId) return c.json({ error: 'ValidationError', message: 'episodeId is required' }, 400);
  const result = await generateThumbnailPrompt(db, episodeId);
  return c.json({ data: result });
});

// Consistency check
aiRouter.post('/consistency', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { subtitleId } = body as { subtitleId: string };
  if (!subtitleId) return c.json({ error: 'ValidationError', message: 'subtitleId is required' }, 400);
  const result = await runConsistencyCheck(db, subtitleId);
  return c.json({ data: result });
});

aiRouter.post('/subtitle-rewrite', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { subtitleId, instruction } = body as { subtitleId: string; instruction: string };
  if (!subtitleId || !instruction) {
    return c.json({ error: 'ValidationError', message: 'subtitleId and instruction are required' }, 400);
  }
  const result = await rewriteSubtitleWithAI(db, subtitleId, instruction);
  const subtitle = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  const episode = subtitle
    ? db.select().from(schema.episodes).where(eq(schema.episodes.id, subtitle.episodeId)).get()
    : null;
  if (episode?.movieId) {
    await syncMovieWorkspaceToMongo(db, episode.movieId).catch(() => null);
  }
  return c.json({ data: result });
});

// ---------------------------------------------------------------------------
function getApiKey(
  settings: typeof schema.settings.$inferSelect,
  provider: AIProviderType,
): string {
  // First try stored (encrypted) key from DB; fall back to env var.
  const envKey = {
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    claude: process.env.CLAUDE_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    qwen: process.env.QWEN_API_KEY,
    local: 'ollama',
  }[provider];
  const storedKey = {
    gemini: settings.geminiApiKey,
    openai: settings.openaiApiKey,
    claude: settings.claudeApiKey,
    deepseek: settings.deepseekApiKey,
    openrouter: settings.openrouterApiKey,
    qwen: settings.qwenApiKey,
    local: 'ollama',
  }[provider];
  return storedKey || envKey || '';
}
