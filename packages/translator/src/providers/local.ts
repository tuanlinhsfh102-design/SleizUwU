import { OpenAIProvider } from './openai.js';
import type { AIProviderConfig } from '@sleiz/shared';

/** Local LLM via Ollama (OpenAI-compatible at /v1). */
export class LocalProvider extends OpenAIProvider {
  readonly type = 'local' as const;
  constructor(config: AIProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl || 'http://localhost:11434/v1' });
    // Local Ollama doesn't require a real key, but the OpenAI client forces a non-empty string.
    this.apiKey = config.apiKey || 'ollama';
  }
}
