/**
 * Subtitle translation orchestration:
 *  - Split cues into batches of N (default 100)
 *  - Persist Batch rows so progress is resumable
 *  - Run batchTranslate() with translation memory + glossary
 *  - Write translated text back into the subtitle's cues JSON
 *  - Update settings.totalTokensUsed / totalCostUsd
 *  - Update episode status
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { SUBTITLE_TRANSLATION_SYSTEM_PROMPT, uuid, resolveAIModel, type AIProviderType, type SubtitleCue } from '@sleiz/shared';
import {
  createProvider,
  batchTranslate,
  TranslationMemoryStore,
  loadGlossary,
} from '@sleiz/translator';
import { addHistory } from './history.js';
import { rt } from './realtime.js';
import { isPermanentKeyError, loadGeminiKeys, markGeminiKeyFailed, pickGeminiKey, removeGeminiKey } from './gemini-keys.js';

export interface TranslateOptions {
  provider?: AIProviderType;
  model?: string;
  channelId?: string;
  movieId?: string;
  batchSize?: number;
  signal?: AbortSignal;
}

export interface TranslateResult {
  subtitleId: string;
  totalCues: number;
  translatedCues: number;
  fromMemory: number;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  batches: Array<{ id: string; index: number; status: string; processed: number; total: number }>;
}

function buildPreviousEpisodeContext(db: DB, movieId: string | undefined, episodeNumber: number): string {
  if (!movieId) return '';

  const subtitles = db
    .select({ cues: schema.subtitles.cues })
    .from(schema.episodes)
    .innerJoin(schema.subtitles, eq(schema.subtitles.episodeId, schema.episodes.id))
    .where(and(eq(schema.episodes.movieId, movieId), lt(schema.episodes.episodeNumber, episodeNumber)))
    .orderBy(desc(schema.episodes.episodeNumber))
    .limit(3)
    .all();

  const lines: string[] = [];
  for (const subtitle of subtitles) {
    const cues = JSON.parse(subtitle.cues) as SubtitleCue[];
    for (const cue of cues) {
      const translated = cue.textTranslated?.trim();
      if (!translated) continue;
      lines.push(`[ZH] ${cue.textOriginal}\n[VI] ${translated}`);
      if (lines.length === 80) break;
    }
    if (lines.length === 80) break;
  }

  return lines.length > 0
    ? `\n\nPrevious episode translations for consistency (reference only):\n${lines.join('\n\n')}`
    : '';
}

export async function translateSubtitle(
  db: DB,
  subtitleId: string,
  opts: TranslateOptions,
): Promise<TranslateResult> {
  const start = Date.now();
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!sub) throw new Error(`Subtitle not found: ${subtitleId}`);

  // Find episode + movie + channel for prompts/glossary
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  if (!episode) throw new Error(`Episode not found for subtitle`);
  const movie = episode.movieId
    ? db.select().from(schema.movies).where(eq(schema.movies.id, episode.movieId)).get()
    : null;
  const channel = movie?.channelId
    ? db.select().from(schema.channels).where(eq(schema.channels.id, movie.channelId)).get()
    : null;

  // Resolve provider/model/keys
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!settings) throw new Error('Settings not initialized');

  const providerType = (opts.provider || settings.defaultProvider || 'gemini') as AIProviderType;
  // For Gemini, use round-robin rotation across multiple configured keys.
  // A Gemini key can be temporarily parked after a quota/server error. Do
  // not reject the whole job merely because every configured key is cooling
  // down at this instant: the per-batch loop waits and retries it safely.
  const configuredGeminiKeys = providerType === 'gemini' ? loadGeminiKeys(db) : [];
  const apiKey = providerType === 'gemini' ? pickGeminiKey(db) : getApiKey(settings, providerType);
  if (providerType === 'gemini') {
    if (configuredGeminiKeys.length === 0 && !process.env.GEMINI_API_KEY) {
      throw new Error('No API key configured for gemini');
    }
  } else if (!apiKey) {
    throw new Error(`No API key configured for ${providerType}`);
  }
  const modelId = resolveAIModel(providerType, opts.model || settings.defaultModel);
  // Build system prompt
  let systemPrompt = channel?.aiPrompt ? `${channel.aiPrompt}\n\n` : '';
  systemPrompt += SUBTITLE_TRANSLATION_SYSTEM_PROMPT;

  // Load glossary
  const glossary = await loadGlossary(db, {
    channelId: opts.channelId || movie?.channelId,
    movieId: opts.movieId || movie?.id,
  });
  systemPrompt += glossary.buildPromptBlock();
  systemPrompt += buildPreviousEpisodeContext(db, movie?.id, episode.episodeNumber);

  // Translation memory
  const memory = new TranslationMemoryStore(db);

  // Parse cues
  const cues = JSON.parse(sub.cues) as SubtitleCue[];

  // Split into batches
  const batchSize = opts.batchSize || settings.batchSize || 100;
  const batches: Array<{ id: string; index: number; start: number; end: number }> = [];
  for (let i = 0; i < cues.length; i += batchSize) {
    batches.push({
      id: uuid(),
      index: batches.length,
      start: i,
      end: Math.min(i + batchSize, cues.length),
    });
  }

  // Delete any old batches for this subtitle
  db.delete(schema.batches).where(eq(schema.batches.subtitleId, subtitleId)).run();

  // Create batch rows
  const now = () => Math.floor(Date.now() / 1000);
  for (const b of batches) {
    db.insert(schema.batches)
      .values({
        id: b.id,
        episodeId: sub.episodeId,
        subtitleId,
        batchIndex: b.index,
        startCue: b.start,
        endCue: b.end,
        totalCues: b.end - b.start,
        status: 'queued',
        provider: providerType,
        model: modelId,
        retryCount: 0,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
  }

  // Update episode status
  db.update(schema.episodes)
    .set({ status: 'translating', updatedAt: now() })
    .where(eq(schema.episodes.id, sub.episodeId))
    .run();
  rt.updated('episodes', sub.episodeId, { movieId: movie?.id });
  rt.updated('batches', undefined, { subtitleId });
  rt.progress('batches', subtitleId, { done: 0, total: batches.length, status: 'running' }, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });

  // Run batches strictly in source order. Each iteration awaits the provider
  // response before starting the next batch, so this workflow never sends
  // more than one translation batch at a time.
  let totalTokens = 0;
  let totalCost = 0;
  let totalTranslated = 0;
  let totalFromMemory = 0;
  let cancelled = false;
  let failedBatches = 0;

  for (const b of batches) {
    if (opts.signal?.aborted) {
      db.update(schema.batches)
        .set({ status: 'cancelled', updatedAt: now() })
        .where(eq(schema.batches.id, b.id))
        .run();
      cancelled = true;
      break;
    }

    db.update(schema.batches)
      .set({ status: 'running', error: null, updatedAt: now() })
      .where(eq(schema.batches.id, b.id))
      .run();
    rt.updated('batches', b.id, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });

    // A new "Dịch bằng Gemini" run is a resume operation. Do not send cues
    // that were completed in an earlier run again; only process rows that
    // still have no translated text (including previously failed rows).
    const batchCues = cues
      .slice(b.start, b.end)
      .filter((cue) => !cue.textTranslated?.trim());
    const items = batchCues.map((c) => ({ id: c.id, index: c.index, source: c.textOriginal }));
    if (items.length === 0) {
      db.update(schema.batches)
        .set({
          status: 'completed',
          processedCues: b.end - b.start,
          error: null,
          updatedAt: now(),
        })
        .where(eq(schema.batches.id, b.id))
        .run();
      rt.updated('batches', b.id, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
      continue;
    }
    let batchTokens = 0;
    let batchCost = 0;
    let batchDone = 0;
    const pendingItems = [...items];
    // `batchTranslate` sends the full cache-miss batch in one structured
    // request. Keep its concurrency at one as an additional safeguard.
    const requestConcurrency = 1;
    // Retry a transient Gemini failure, but always move on to later batches.
    // An unlimited retry here previously made a single malformed/provider-
    // rejected batch block the entire subtitle indefinitely.
    const maxAttempts = providerType === 'gemini' ? 5 : 1;
    let attempt = 0;
    let lastError = '';

    while (pendingItems.length > 0 && attempt < maxAttempts) {
      const activeApiKey = providerType === 'gemini' ? pickGeminiKey(db) : apiKey;
      if (!activeApiKey) {
        // A permanently rejected key is removed from Settings. If that left
        // no usable configured key, record this batch and continue with the
        // rest of the subtitle instead of terminating the detached job.
        if (providerType === 'gemini' && loadGeminiKeys(db).length === 0 && !process.env.GEMINI_API_KEY) {
          attempt = maxAttempts;
          break;
        }
        attempt++;
        db.update(schema.batches)
          .set({
            retryCount: attempt,
            error: `Đang chờ khóa Gemini khả dụng để tự thử lại lần ${attempt + 1}.`,
            updatedAt: now(),
          })
          .where(eq(schema.batches.id, b.id))
          .run();
        await waitForRetry(retryDelayFor(attempt), opts.signal);
        if (opts.signal?.aborted) {
          cancelled = true;
          break;
        }
        continue;
      }
      const provider = createProvider({ provider: providerType, model: modelId, apiKey: activeApiKey });
      const attemptItems = pendingItems.splice(0);
      // Large 100-line replies are prone to timeouts, truncated JSON, or
      // provider output limits. The database/UI still track 100-line batches,
      // but provider requests are deliberately smaller and shrink again on a
      // retry so one troublesome group never blocks the entire subtitle.
      const requestSize = attempt === 0 ? 20 : 8;
      const maxTokens = attempt === 0 ? 6_144 : 3_072;
      const results = [] as Awaited<ReturnType<typeof batchTranslate>>;
      for (let offset = 0; offset < attemptItems.length; offset += requestSize) {
        if (opts.signal?.aborted) break;
        const requestItems = attemptItems.slice(offset, offset + requestSize);
        const requestResults = await batchTranslate(requestItems, {
          provider,
          systemPrompt: attempt > 0
            ? `${systemPrompt}\n\nCorrection required: a previous response retained Chinese characters. For this retry, verify every output text contains zero Han/Chinese characters before returning JSON. Translate or Vietnamese-transliterate all names, titles, sound effects, and short reactions.`
            : systemPrompt,
          glossary,
          memory,
          movieId: movie?.id,
          temperature: settings.temperature,
          maxTokens,
          timeoutMs: 90_000,
          concurrency: requestConcurrency,
          signal: opts.signal,
          retryDelayMs: undefined,
        });
        results.push(...requestResults);
      }

      if (opts.signal?.aborted) {
        db.update(schema.batches)
          .set({ status: 'cancelled', updatedAt: now() })
          .where(eq(schema.batches.id, b.id))
          .run();
        cancelled = true;
        break;
      }

      const retryItems: typeof attemptItems = [];
      const returnedItemIds = new Set(results.map((result) => result.id));
      for (const result of results) {
        if (result.usage) {
          batchTokens += result.usage.totalTokens;
          batchCost += result.usage.costUsd;
        }

        const cueIdx = cues.findIndex((cue) => cue.id === result.id);
        if (!result.error && result.target.trim()) {
          if (cueIdx >= 0) {
            cues[cueIdx].textTranslated = result.target;
            cues[cueIdx].status = 'translated';
          }
          batchDone++;
          totalTranslated++;
          if (result.fromMemory) totalFromMemory++;
          db.update(schema.batches)
            .set({ processedCues: batchDone, updatedAt: now() })
            .where(eq(schema.batches.id, b.id))
            .run();
        } else {
          if (result.error) lastError = result.error;
          const source = attemptItems.find((item) => item.id === result.id);
          if (source) retryItems.push(source);
        }
      }

      // A cancelled or malformed provider response can omit an item entirely.
      // Keep those cues pending instead of falsely completing the batch.
      for (const item of attemptItems) {
        if (!returnedItemIds.has(item.id)) {
          retryItems.push(item);
          lastError ||= 'AI response did not include every requested subtitle line.';
        }
      }

      if (retryItems.length === 0) break;
      attempt++;
      pendingItems.push(...retryItems);
      // Rotate Gemini key and retry only the failed cues. The previous code
      // recorded per-cue failures but still marked the whole batch completed,
      // which produced partially untranslated SRT files.
      if (providerType === 'gemini') {
        if (isPermanentKeyError(lastError)) removeGeminiKey(db, activeApiKey);
        // Invalid JSON/missing segments are output-shape issues, not a bad
        // API key. Keep the key available and retry with smaller requests.
        else if (isTransientGeminiFailure(lastError)) markGeminiKeyFailed(activeApiKey, 60_000);
        db.update(schema.batches)
          .set({
            retryCount: attempt,
            error: `Đang tự thử lại lần ${attempt + 1}/${maxAttempts}: ${formatBatchError(lastError)}`,
            updatedAt: now(),
          })
          .where(eq(schema.batches.id, b.id))
          .run();
        await waitForRetry(retryDelayFor(attempt), opts.signal);
        if (opts.signal?.aborted) {
          cancelled = true;
          break;
        }
      } else {
        break;
      }
    }

    if (cancelled) break;

    if (pendingItems.length > 0) {
      const failedMessage = `Không thể dịch ${pendingItems.length}/${items.length} dòng sau ${Math.min(attempt + 1, maxAttempts)} lần thử. Lỗi cuối: ${formatBatchError(lastError)}`;
      for (const item of pendingItems) {
        const cueIdx = cues.findIndex((cue) => cue.id === item.id);
        if (cueIdx >= 0) cues[cueIdx].status = 'error';
      }
      db.update(schema.subtitles)
        .set({ cues: JSON.stringify(cues), updatedAt: now() })
        .where(eq(schema.subtitles.id, subtitleId))
        .run();
      db.update(schema.batches)
        .set({ status: 'failed', processedCues: batchDone, error: failedMessage, updatedAt: now() })
        .where(eq(schema.batches.id, b.id))
        .run();
      rt.updated('subtitles', subtitleId, { episodeId: sub.episodeId, movieId: movie?.id });
      rt.updated('batches', b.id, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
      failedBatches++;
      // Keep processing the remaining batches. A later retry can resume only
      // the error rows, rather than forcing users to restart the whole file.
      continue;
    }

    // Store each completed batch immediately. This makes translated rows
    // available to the workspace while the remaining batches continue.
    db.update(schema.subtitles)
      .set({ cues: JSON.stringify(cues), updatedAt: now() })
      .where(eq(schema.subtitles.id, subtitleId))
      .run();
    rt.updated('subtitles', subtitleId, { episodeId: sub.episodeId, movieId: movie?.id });

    totalTokens += batchTokens;
    totalCost += batchCost;

    db.update(schema.batches)
      .set({
        status: 'completed',
        processedCues: b.end - b.start,
        error: null,
        tokenInput: Math.floor(batchTokens * 0.6),
        tokenOutput: Math.floor(batchTokens * 0.4),
        costUsd: batchCost,
        durationMs: 0,
        updatedAt: now(),
      })
      .where(eq(schema.batches.id, b.id))
      .run();
    const batchIdxCompleted = b.index + 1;
    rt.updated('batches', b.id, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
    rt.progress('batches', subtitleId, { done: batchIdxCompleted, total: batches.length, failed: 0, status: 'running' }, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
    rt.updated('subtitles', subtitleId, { episodeId: sub.episodeId, movieId: movie?.id });
  }

  if (cancelled || opts.signal?.aborted) {
    db.update(schema.batches)
      .set({ status: 'cancelled', updatedAt: now() })
      .where(and(
        eq(schema.batches.subtitleId, subtitleId),
        inArray(schema.batches.status, ['queued', 'running']),
      ))
      .run();
    db.update(schema.subtitles)
      .set({ cues: JSON.stringify(cues), updatedAt: now() })
      .where(eq(schema.subtitles.id, subtitleId))
      .run();
    db.update(schema.episodes)
      .set({ status: 'pending', updatedAt: now() })
      .where(eq(schema.episodes.id, sub.episodeId))
      .run();
    rt.updated('subtitles', subtitleId, { episodeId: sub.episodeId, movieId: movie?.id });
    rt.updated('episodes', sub.episodeId, { movieId: movie?.id });
    rt.progress('batches', subtitleId, { done: totalTranslated, total: cues.length, status: 'cancelled' }, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
    const batchRows = db.select().from(schema.batches).where(eq(schema.batches.subtitleId, subtitleId)).all();
    return {
      subtitleId, totalCues: cues.length, translatedCues: totalTranslated, fromMemory: totalFromMemory,
      tokensUsed: totalTokens, costUsd: totalCost, durationMs: Date.now() - start,
      batches: batchRows.map((b) => ({ id: b.id, index: b.batchIndex, status: b.status, processed: b.processedCues, total: b.totalCues })),
    };
  }

  // Persist translated cues back to subtitle
  db.update(schema.subtitles)
    .set({ cues: JSON.stringify(cues), updatedAt: now() })
    .where(eq(schema.subtitles.id, subtitleId))
    .run();

  // Update settings totals
  db.update(schema.settings)
    .set({
      totalTokensUsed: (settings.totalTokensUsed || 0) + totalTokens,
      totalCostUsd: (settings.totalCostUsd || 0) + totalCost,
      updatedAt: now(),
    })
    .run();

  // A job with failed batches is terminal, but not fully translated. Keep the
  // episode importable/retryable and report an accurate partial state.
  const terminalStatus = failedBatches === 0 ? 'translated' : 'imported';
  db.update(schema.episodes)
    .set({ status: terminalStatus, updatedAt: now() })
    .where(eq(schema.episodes.id, sub.episodeId))
    .run();
  rt.updated('episodes', sub.episodeId, { movieId: movie?.id });
  rt.progress('batches', subtitleId, {
    done: batches.length - failedBatches,
    total: batches.length,
    failed: failedBatches,
    status: failedBatches === 0 ? 'completed' : 'partial',
  }, { subtitleId, episodeId: sub.episodeId, movieId: movie?.id });
  rt.updated('settings', 'default');

  await addHistory(db, {
    action: 'translate',
    entityType: 'subtitle',
    entityId: subtitleId,
    details: `${totalTranslated} cues translated (${totalFromMemory} from memory), ${totalTokens} tokens, $${totalCost.toFixed(4)}`,
  });

  const batchRows = db.select().from(schema.batches).where(eq(schema.batches.subtitleId, subtitleId)).all();

  return {
    subtitleId,
    totalCues: cues.length,
    translatedCues: totalTranslated,
    fromMemory: totalFromMemory,
    tokensUsed: totalTokens,
    costUsd: totalCost,
    durationMs: Date.now() - start,
    batches: batchRows.map((b) => ({
      id: b.id,
      index: b.batchIndex,
      status: b.status,
      processed: b.processedCues,
      total: b.totalCues,
    })),
  };
}

function retryDelayFor(attempt: number): number {
  return Math.min(60_000, 2_500 * 2 ** Math.min(attempt - 1, 5));
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(cleanup, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
    };
    function cleanup() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isTransientGeminiFailure(message: string): boolean {
  return /\b429\b|\b5\d{2}\b|timeout|timed out|network|fetch failed|ECONN|ENOTFOUND/i.test(message);
}

function formatBatchError(message: string): string {
  const value = message.trim().replace(/\s+/g, ' ');
  if (!value) return 'Gemini không trả về kết quả hợp lệ.';
  // Do not persist full provider payloads, which can be noisy and may include
  // request metadata. The UI only needs the useful explanation.
  return value.length > 280 ? `${value.slice(0, 277)}...` : value;
}

function getApiKey(
  settings: typeof schema.settings.$inferSelect,
  provider: AIProviderType,
): string {
  const storedKey = {
    gemini: settings.geminiApiKey,
    openai: settings.openaiApiKey,
    claude: settings.claudeApiKey,
    deepseek: settings.deepseekApiKey,
    openrouter: settings.openrouterApiKey,
    qwen: settings.qwenApiKey,
    local: 'ollama',
  }[provider];
  const envKey = {
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    claude: process.env.CLAUDE_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    qwen: process.env.QWEN_API_KEY,
    local: 'ollama',
  }[provider];
  return storedKey || envKey || '';
}
