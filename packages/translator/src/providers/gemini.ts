import type { AIProviderConfig, AIResult, AIMessage, TranslateOpts } from '@sleiz/shared';
import { AI_PRICING, estimateTokens } from '@sleiz/shared';
import type { AIProvider } from '@sleiz/translator';

/**
 * Google Gemini provider (default).
 * Uses the v1beta generateContent endpoint.
 */
export class GeminiProvider implements AIProvider {
  readonly type = 'gemini' as const;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-3.1-flash-lite-preview';
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async translate(messages: AIMessage[], opts: TranslateOpts = {}): Promise<AIResult> {
    const start = Date.now();
    const controller = new AbortController();
    // Gemini can legitimately take longer than 45 seconds when the prompt
    // includes glossary/context. Keep a bounded deadline so a stalled socket
    // is still retried, without aborting a response that is making progress.
    const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 90_000, 15_000), 180_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortRequest = () => controller.abort();
    opts.signal?.addEventListener('abort', abortRequest, { once: true });

    // Convert OpenAI-style messages to Gemini format
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role === 'user');
    const contents = userMsgs.map((m) => ({
      role: 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.stop ? { stopSequences: opts.stop } : {}),
      },
    };
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !opts.signal?.aborted) {
        throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', abortRequest);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    const promptTokens = data.usageMetadata?.promptTokenCount ?? estimateTokens(messages.map((m) => m.content).join(''));
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? estimateTokens(text);
    const totalTokens = data.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens;

    const price = AI_PRICING[this.model] || { input: 0.075, output: 0.3 };
    const costUsd = (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
      },
      provider: 'gemini',
      model: this.model,
      durationMs: Date.now() - start,
    };
  }
}
