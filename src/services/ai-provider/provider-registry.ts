// ============================================================
// AI Provider 注册中心
// 管理所有已注册的 AI 提供商实例，按功能分发请求
// ============================================================

import type {
  AIProvider, AIProviderId, AIFunction, UserAIConfig,
  Message, ChatOptions, ChatResponse, StreamEvent
} from './types';

class ProviderRegistry {
  private providers = new Map<AIProviderId, AIProvider>();
  private config: UserAIConfig | null = null;

  /** 注册一个 AI 提供商 */
  register(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** 获取所有已注册提供商 */
  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /** 按区域过滤提供商 */
  getByRegion(region: 'global' | 'china'): AIProvider[] {
    return this.getAll().filter(
      p => p.region === region || p.region === 'both'
    );
  }

  /** 获取特定提供商 */
  get(id: AIProviderId): AIProvider | undefined {
    return this.providers.get(id);
  }

  /** 加载用户配置 */
  loadConfig(config: UserAIConfig): void {
    this.config = config;

    // 为每个已保存的 API Key 设置到对应 provider
    for (const [providerId, key] of Object.entries(config.apiKeys)) {
      const provider = this.providers.get(providerId as AIProviderId);
      if (provider && key) {
        provider.setApiKey(key);
      }
    }

    // 设置模型选择
    for (const [providerId, modelId] of Object.entries(config.selectedModels)) {
      const provider = this.providers.get(providerId as AIProviderId);
      if (provider && modelId) {
        provider.currentModel = modelId;
      }
    }
  }

  /** 获取当前配置 */
  getConfig(): UserAIConfig | null {
    return this.config;
  }

  /** 获取指定功能应使用的 provider */
  getProviderForFunction(fn: AIFunction): AIProvider {
    if (!this.config) {
      throw new Error('AI 配置未加载。请先完成初始设置。');
    }

    // 检查是否有功能级别的覆盖
    const overrideId = this.config.functionOverrides?.[fn];
    const providerId = overrideId || this.config.defaultProvider;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`AI 提供商 "${providerId}" 未注册。请检查配置。`);
    }

    return provider;
  }

  /** 便捷方法：使用指定功能的 provider 进行聊天 */
  async chat(
    fn: AIFunction,
    messages: Message[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const provider = this.getProviderForFunction(fn);
    return provider.chat(messages, options);
  }

  /** 便捷方法：使用指定功能的 provider 进行流式聊天 */
  async *streamChat(
    fn: AIFunction,
    messages: Message[],
    options?: ChatOptions
  ): AsyncGenerator<StreamEvent> {
    const provider = this.getProviderForFunction(fn);
    yield* provider.streamChat(messages, options);
  }

  /** 测试所有已配置 Key 的提供商连接 */
  async testAllConnections(): Promise<Map<AIProviderId, { ok: boolean; latencyMs: number; error?: string }>> {
    const results = new Map<AIProviderId, { ok: boolean; latencyMs: number; error?: string }>();

    for (const [id, provider] of this.providers) {
      const hasKey = this.config?.apiKeys[id];
      if (hasKey) {
        try {
          const result = await provider.testConnection();
          results.set(id, result);
        } catch (err) {
          results.set(id, {
            ok: false,
            latencyMs: 0,
            error: err instanceof Error ? err.message : '连接失败'
          });
        }
      }
    }

    return results;
  }
}

/** 全局单例 */
export const providerRegistry = new ProviderRegistry();
