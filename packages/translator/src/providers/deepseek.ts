import { OpenAIProvider } from './openai.js';
import type { AIProviderConfig } from '@sleiz/shared';

/** DeepSeek - OpenAI-compatible API. */
export class DeepSeekProvider extends OpenAIProvider {
  readonly type = 'deepseek' as const;
  constructor(config: AIProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl || 'https://api.deepseek.com/v1' });
  }
}
