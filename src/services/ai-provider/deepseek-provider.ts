// ============================================================
// DeepSeek Provider (works in China & globally)
// Uses OpenAI-compatible API format
// ============================================================

import type { AIProviderId, RegionAvailability, ModelOption } from './types';
import { OpenAICompatibleProvider } from './openai-compatible-base';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'deepseek';
  readonly name = 'DeepSeek';
  readonly nameEn = 'DeepSeek';
  readonly region: RegionAvailability = 'both';
  readonly website = 'https://www.deepseek.com';
  readonly apiKeyGuideUrl = 'https://platform.deepseek.com/api_keys';
  protected baseUrl = 'https://api.deepseek.com';

  readonly models: ModelOption[] = [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek-V3',
      tier: 'balanced',
      contextWindow: 64000,
      inputPrice: 0.27,
      outputPrice: 1.1,
      recommended: true,
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek-R1',
      tier: 'powerful',
      contextWindow: 64000,
      inputPrice: 0.55,
      outputPrice: 2.19,
    },
  ];

  currentModel = 'deepseek-chat';
}
