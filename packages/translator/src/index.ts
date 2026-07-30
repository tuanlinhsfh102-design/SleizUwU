/** @sleiz/translator - AI provider abstraction and translation engine. */
import type { AIProviderConfig, AIProviderType, AIResult, AIMessage, TranslateOpts } from '@sleiz/shared';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import { ClaudeProvider } from './providers/claude.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { QwenProvider } from './providers/qwen.js';
import { LocalProvider } from './providers/local.js';
import { TranslationMemoryStore } from './memory.js';
import { GlossaryReplacer, loadGlossary } from './glossary.js';

export interface AIProvider {
  readonly type: AIProviderType;
  translate(messages: AIMessage[], opts?: TranslateOpts): Promise<AIResult>;
}

export function createProvider(config: AIProviderConfig): AIProvider {
  switch (config.provider) {
    case 'gemini': return new GeminiProvider(config);
    case 'openai': return new OpenAIProvider(config);
    case 'claude': return new ClaudeProvider(config);
    case 'deepseek': return new DeepSeekProvider(config);
    case 'openrouter': return new OpenRouterProvider(config);
    case 'qwen': return new QwenProvider(config);
    case 'local': return new LocalProvider(config);
    default: throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

export interface BatchTranslateItem { id: string; index: number; source: string; context?: string }
export interface BatchTranslateResult {
  id: string;
  source: string;
  target: string;
  fromMemory: boolean;
  usage?: AIResult['usage'];
  error?: string;
}
export interface BatchTranslateOptions {
  provider: AIProvider;
  systemPrompt: string;
  glossary?: GlossaryReplacer;
  memory?: TranslationMemoryStore;
  movieId?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  retryDelayMs?: number;
  onProgress?: (done: number, total: number, item: BatchTranslateResult) => void;
}

/** One provider call translates the whole cache-miss batch (normally 100 cues). */
export async function batchTranslate(items: BatchTranslateItem[], opts: BatchTranslateOptions): Promise<BatchTranslateResult[]> {
  const results: BatchTranslateResult[] = [];
  const uncached: BatchTranslateItem[] = [];
  let done = 0;
  const notify = (result: BatchTranslateResult) => { results.push(result); done++; opts.onProgress?.(done, items.length, result); };

  for (const item of items) {
    if (opts.signal?.aborted) break;
    const cached = opts.memory ? await opts.memory.lookup(item.source) : null;
    if (!cached) { uncached.push(item); continue; }
    const target = opts.glossary ? opts.glossary.apply(cached) : cached;
    if (translationValidationError(target)) {
      uncached.push(item);
      continue;
    }
    notify({ id: item.id, source: item.source, target, fromMemory: true });
  }
  if (!uncached.length || opts.signal?.aborted) return results;

  try {
    if (opts.retryDelayMs && opts.retryDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, opts.retryDelayMs));
    const response = await opts.provider.translate([
      { role: 'system', content: opts.systemPrompt },
      {
        role: 'user',
        content: 'Translate the input segments. Respond with this exact JSON object shape only: {"segments":[{"index":1,"text":"Vietnamese sentence"}]}. Preserve each input index exactly and include every input segment once. IMPORTANT: Every text value must be Vietnamese only. Do not copy any Han/Chinese characters from the input, including names or sound effects; transliterate or translate them naturally into Vietnamese.\n\n' + JSON.stringify(uncached.map((item) => ({ index: item.index, text: item.source, ...(item.context ? { context: item.context } : {}) }))),
      },
    ], {
      temperature: opts.temperature ?? 0.3,
      maxTokens: opts.maxTokens ?? 6_144,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const translations = new Map(parseBatchResponse(response.text).map((entry) => [entry.index, entry.text]));
    for (const item of uncached) {
      let target = translations.get(item.index)?.trim() ?? '';
      if (target && opts.glossary) target = opts.glossary.apply(target);
      const validationError = translationValidationError(target);
      if (validationError) target = '';
      if (target && opts.memory) await opts.memory.store(item.source, target, opts.provider.type, opts.movieId);
      notify({ id: item.id, source: item.source, target, fromMemory: false, usage: item === uncached[0] ? response.usage : undefined, error: validationError ?? (target ? undefined : 'AI batch response is missing a translation for this cue.') });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const item of uncached) notify({ id: item.id, source: item.source, target: '', fromMemory: false, error: message });
  }
  return results;
}

function parseBatchResponse(text: string): Array<{ index: number; text: string }> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    // Gemini occasionally adds a short sentence before/after the JSON even
    // when asked not to. Recover the object payload instead of failing an
    // otherwise usable translation batch.
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('AI response does not contain a JSON translation object.');
    }
    try {
      value = JSON.parse(normalized.slice(start, end + 1));
    } catch {
      throw new Error('AI returned an invalid JSON translation object.');
    }
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { segments?: unknown }).segments)) {
    throw new Error('AI batch response must be a JSON object with a segments array.');
  }
  const entries = (value as { segments: unknown[] }).segments.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    return typeof record.index === 'number' && Number.isInteger(record.index) && typeof record.text === 'string'
      ? [{ index: record.index, text: record.text }]
      : [];
  });
  if (entries.length !== (value as { segments: unknown[] }).segments.length) {
    throw new Error('AI batch response contains an invalid subtitle segment.');
  }
  return entries;
}

function translationValidationError(text: string): string | undefined {
  const value = text.trim();
  if (!value) return 'AI batch response is missing a translation for this cue.';
  if (/^[.\-…\s]+$/.test(value) || /^\[(?:inaudible|unknown)\]$/i.test(value)) {
    return 'AI returned an empty or placeholder subtitle translation.';
  }
  const hanCharacters = value.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) ?? [];
  if (hanCharacters.length > 0) {
    return `AI returned ${hanCharacters.length} Chinese character${hanCharacters.length === 1 ? '' : 's'} in a Vietnamese subtitle translation.`;
  }
  return undefined;
}

export { TranslationMemoryStore, GlossaryReplacer, loadGlossary };
export type { AIProviderConfig, AIResult, AIMessage, TranslateOpts } from '@sleiz/shared';
