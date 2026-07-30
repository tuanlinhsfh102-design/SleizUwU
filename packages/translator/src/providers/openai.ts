import type { AIProvider, AIProviderConfig, AIResult, AIMessage, TranslateOpts } from '@sleiz/translator';
import { AI_PRICING, estimateTokens } from '@sleiz/shared';

/** OpenAI-compatible provider (works for OpenAI, also as base for DeepSeek/Qwen/OpenRouter). */
export class OpenAIProvider implements AIProvider {
  readonly type = 'openai' as const;
  protected apiKey: string;
  protected model: string;
  protected baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  async translate(messages: AIMessage[], opts: TranslateOpts = {}): Promise<AIResult> {
    const start = Date.now();

    const body = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens,
      stop: opts.stop,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const promptTokens = data.usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join(''));
    const completionTokens = data.usage?.completion_tokens ?? estimateTokens(text);
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    const price = AI_PRICING[this.model] || { input: 0.15, output: 0.6 };
    const costUsd = (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
      },
      provider: this.type,
      model: this.model,
      durationMs: Date.now() - start,
    };
  }
}
