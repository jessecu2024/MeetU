// ============================================================
// AI Provider 模块入口
// 在应用启动时调用 initializeProviders() 注册所有提供商
// ============================================================

export * from './types';
export { providerRegistry } from './provider-registry';

import { providerRegistry } from './provider-registry';
import { ClaudeProvider } from './claude-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { OpenAIProvider, GeminiProvider, QwenProvider, MiniMaxProvider, GLMProvider } from './other-providers';

/** 注册所有 AI 提供商 — 在应用启动时调用一次 */
export function initializeProviders(): void {
  providerRegistry.register(new ClaudeProvider());
  providerRegistry.register(new OpenAIProvider());
  providerRegistry.register(new GeminiProvider());
  providerRegistry.register(new DeepSeekProvider());
  providerRegistry.register(new QwenProvider());
  providerRegistry.register(new MiniMaxProvider());
  providerRegistry.register(new GLMProvider());
}

/** 获取分区域的提供商信息（用于 UI 展示） */
export function getProvidersByRegion() {
  return {
    global: providerRegistry.getByRegion('global'),
    china: providerRegistry.getByRegion('china'),
  };
}
