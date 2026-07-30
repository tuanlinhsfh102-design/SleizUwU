import { OpenAIProvider } from './openai.js';
import type { AIProviderConfig } from '@sleiz/shared';

/** Qwen / DashScope - OpenAI-compatible mode. */
export class QwenProvider extends OpenAIProvider {
  readonly type = 'qwen' as const;
  constructor(config: AIProviderConfig) {
    super({ ...config, baseUrl: config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
  }
}
