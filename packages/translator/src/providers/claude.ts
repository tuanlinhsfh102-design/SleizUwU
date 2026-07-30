import type { AIProviderConfig, AIResult, AIMessage, TranslateOpts } from '@sleiz/shared';
import { estimateTokens } from '@sleiz/shared';
import type { AIProvider } from '@sleiz/translator';

/** Anthropic Claude provider. Uses the Messages API. */
export class ClaudeProvider implements AIProvider {
  readonly type = 'claude' as const;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'claude-3-5-haiku-latest';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
  }

  async translate(messages: AIMessage[], opts: TranslateOpts = {}): Promise<AIResult> {
    const start = Date.now();
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role !== 'system');

    const body = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.3,
      system: systemMsg?.content,
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
      stop_sequences: opts.stop,
    };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content?.map((c) => c.text).join('') ?? '';
    const promptTokens = data.usage?.input_tokens ?? estimateTokens(messages.map((m) => m.content).join(''));
    const completionTokens = data.usage?.output_tokens ?? estimateTokens(text);

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: (promptTokens / 1_000_000) * 0.8 + (completionTokens / 1_000_000) * 4,
      },
      provider: 'claude',
      model: this.model,
      durationMs: Date.now() - start,
    };
  }
}
