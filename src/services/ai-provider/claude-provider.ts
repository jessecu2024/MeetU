// ============================================================
// Anthropic Claude Provider
// 参考实现 — 其他提供商按此模式实现
// ============================================================

import type {
  AIProvider, AIProviderId, RegionAvailability, ModelOption,
  Message, ChatOptions, ChatResponse, StreamEvent, ConnectionTestResult
} from './types';
import { aiFetch } from './ai-fetch';

export class ClaudeProvider implements AIProvider {
  readonly id: AIProviderId = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly nameEn = 'Claude by Anthropic';
  readonly region: RegionAvailability = 'global';
  readonly website = 'https://www.anthropic.com';
  readonly apiKeyGuideUrl = 'https://console.anthropic.com/settings/keys';

  readonly models: ModelOption[] = [
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      tier: 'balanced',
      contextWindow: 200000,
      inputPrice: 3,
      outputPrice: 15,
      recommended: true,
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      tier: 'fast',
      contextWindow: 200000,
      inputPrice: 0.8,
      outputPrice: 4,
    },
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      tier: 'powerful',
      contextWindow: 200000,
      inputPrice: 15,
      outputPrice: 75,
    },
  ];

  currentModel = 'claude-sonnet-4-20250514';
  private apiKey = '';
  private baseUrl = 'https://api.anthropic.com';

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async validateApiKey(key: string): Promise<boolean> {
    try {
      const res = await aiFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const res = await aiFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const status = res.status;
        let errorMsg = err.error?.message || `HTTP ${status}`;
        if (status === 401) errorMsg = `Invalid API Key / API Key 无效 (${status}): ${errorMsg}`;
        else if (status === 403) errorMsg = `Access denied / 访问被拒绝 (${status}): ${errorMsg}`;
        else if (status === 429) errorMsg = `Rate limited / 请求频率过高 (${status})`;
        else if (status >= 500) errorMsg = `Server error / 服务端错误 (${status}): ${errorMsg}`;
        return { ok: false, latencyMs, error: errorMsg };
      }
      return { ok: true, latencyMs, model: 'claude-haiku-4-5-20251001' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      let errorMsg = `Network error / 网络错误: ${msg}`;
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError'))
        errorMsg = 'Cannot reach server — check network/VPN / 无法连接服务器，请检查网络或 VPN';
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: errorMsg,
      };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.currentModel;
    const start = Date.now();

    // Claude API 使用 system 参数而非 system message
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const res = await aiFetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Claude API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return {
      content: data.content.map((c: { text?: string }) => c.text || '').join(''),
      model: data.model,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      latencyMs: Date.now() - start,
    };
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    // IPC proxy doesn't support streaming — fall back to non-streaming chat
    // and emit the full response as a single text_delta + done event
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
