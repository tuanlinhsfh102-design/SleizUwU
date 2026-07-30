import { OpenAIProvider } from './openai.js';
import type { AIProviderConfig } from '@sleiz/shared';

/** OpenRouter - OpenAI-compatible router for many models. */
export class OpenRouterProvider extends OpenAIProvider {
  readonly type = 'openrouter' as const;
  constructor(config: AIProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1' });
  }
}
