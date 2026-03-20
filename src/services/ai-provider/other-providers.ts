// ============================================================
// OpenAI GPT Provider
// ============================================================

import type {
  AIProviderId, RegionAvailability, ModelOption,
  Message, ChatOptions, ChatResponse, StreamEvent, ConnectionTestResult
} from './types';
import { OpenAICompatibleProvider } from './openai-compatible-base';
import { aiFetch } from './ai-fetch';

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'openai';
  readonly name = 'OpenAI GPT';
  readonly nameEn = 'OpenAI GPT';
  readonly region: RegionAvailability = 'global';
  readonly website = 'https://openai.com';
  readonly apiKeyGuideUrl = 'https://platform.openai.com/api-keys';
  protected baseUrl = 'https://api.openai.com';

  readonly models: ModelOption[] = [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'balanced', contextWindow: 128000, inputPrice: 2.5, outputPrice: 10, recommended: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'fast', contextWindow: 128000, inputPrice: 0.15, outputPrice: 0.6 },
    { id: 'o3-mini', name: 'o3-mini', tier: 'powerful', contextWindow: 200000, inputPrice: 1.1, outputPrice: 4.4 },
  ];
  currentModel = 'gpt-4o';
}

// ============================================================
// Google Gemini Provider
// ============================================================

export class GeminiProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'gemini';
  readonly name = 'Google Gemini';
  readonly nameEn = 'Google Gemini';
  readonly region: RegionAvailability = 'global';
  readonly website = 'https://ai.google.dev';
  readonly apiKeyGuideUrl = 'https://aistudio.google.com/apikey';
  protected baseUrl = 'https://generativelanguage.googleapis.com';

  readonly models: ModelOption[] = [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'fast', contextWindow: 1000000, inputPrice: 0.1, outputPrice: 0.4, recommended: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'powerful', contextWindow: 1000000, inputPrice: 1.25, outputPrice: 10 },
  ];
  currentModel = 'gemini-2.0-flash';

  /** Gemini API endpoint builder */
  private geminiUrl(model: string, method: string): string {
    return `${this.baseUrl}/v1beta/models/${model}:${method}?key=${this['apiKey']}`;
  }

  /** Convert standard messages to Gemini's contents format */
  private toGeminiContents(messages: Message[]): { contents: unknown[]; systemInstruction?: unknown } {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const contents = chatMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const result: { contents: unknown[]; systemInstruction?: unknown } = { contents };
    if (systemMsg) {
      result.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }
    return result;
  }

  // ── Gemini uses URL param auth, not Bearer token ──
  protected getHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    const testModel = this.models.find(m => m.tier === 'fast')?.id || this.currentModel;
    try {
      const res = await aiFetch(this.geminiUrl(testModel, 'generateContent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const status = res.status;
        let errorMsg = err.error?.message || `HTTP ${status}`;
        if (status === 400) errorMsg = `Invalid API Key / API Key 无效: ${errorMsg}`;
        else if (status === 403) errorMsg = `API Key forbidden — check Gemini API is enabled / API Key 被禁止: ${errorMsg}`;
        else if (status === 429) errorMsg = `Rate limited — try again later / 请求过于频繁: ${errorMsg}`;
        return { ok: false, latencyMs, error: errorMsg };
      }
      return { ok: true, latencyMs, model: testModel };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Network error / 网络错误' };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.currentModel;
    const start = Date.now();
    const { contents, systemInstruction } = this.toGeminiContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || 4096,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const res = await aiFetch(this.geminiUrl(model, 'generateContent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
    return {
      content: text,
      model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      },
      latencyMs: Date.now() - start,
    };
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    // IPC proxy doesn't support streaming — fall back to non-streaming chat
    try {
      const response = await this.chat(messages, options);
      yield { type: 'text_delta', text: response.content };
      yield {
        type: 'done',
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      };
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}

// ============================================================
// 通义千问 Qwen Provider（阿里云，国内可用）
// ============================================================

export class QwenProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'qwen';
  readonly name = '通义千问 (阿里)';
  readonly nameEn = 'Qwen by Alibaba';
  readonly region: RegionAvailability = 'both';
  readonly website = 'https://tongyi.aliyun.com';
  readonly apiKeyGuideUrl = 'https://dashscope.console.aliyun.com/apiKey';
  protected baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode';

  readonly models: ModelOption[] = [
    { id: 'qwen-plus', name: 'Qwen Plus', tier: 'balanced', contextWindow: 131072, inputPrice: 0.8, outputPrice: 2, recommended: true },
    { id: 'qwen-turbo', name: 'Qwen Turbo', tier: 'fast', contextWindow: 131072, inputPrice: 0.3, outputPrice: 0.6 },
    { id: 'qwen-max', name: 'Qwen Max', tier: 'powerful', contextWindow: 32768, inputPrice: 2.4, outputPrice: 9.6 },
  ];
  currentModel = 'qwen-plus';
}

// ============================================================
// MiniMax Provider（国内可用）
// ============================================================

export class MiniMaxProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'minimax';
  readonly name = 'MiniMax';
  readonly nameEn = 'MiniMax';
  readonly region: RegionAvailability = 'china';
  readonly website = 'https://www.minimaxi.com';
  readonly apiKeyGuideUrl = 'https://platform.minimaxi.com/user-center/basic-information/interface-key';
  protected baseUrl = 'https://api.minimax.chat';

  readonly models: ModelOption[] = [
    { id: 'MiniMax-Text-01', name: 'MiniMax-Text-01', tier: 'balanced', contextWindow: 1000000, inputPrice: 1, outputPrice: 8, recommended: true },
  ];
  currentModel = 'MiniMax-Text-01';
}

// ============================================================
// 智谱 GLM Provider（国内可用）
// ============================================================

export class GLMProvider extends OpenAICompatibleProvider {
  readonly id: AIProviderId = 'glm';
  readonly name = '智谱 GLM';
  readonly nameEn = 'Zhipu GLM';
  readonly region: RegionAvailability = 'china';
  readonly website = 'https://www.zhipuai.cn';
  readonly apiKeyGuideUrl = 'https://open.bigmodel.cn/usercenter/apikeys';
  protected baseUrl = 'https://open.bigmodel.cn/api/paas';

  readonly models: ModelOption[] = [
    { id: 'glm-4-flash', name: 'GLM-4 Flash', tier: 'fast', contextWindow: 128000, inputPrice: 0.1, outputPrice: 0.1, recommended: true },
    { id: 'glm-4-plus', name: 'GLM-4 Plus', tier: 'balanced', contextWindow: 128000, inputPrice: 5, outputPrice: 5 },
  ];
  currentModel = 'glm-4-flash';
}
