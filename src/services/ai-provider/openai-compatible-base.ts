// ============================================================
// OpenAI 兼容格式基础 Provider
// Qwen, MiniMax, GLM, OpenAI 本身都使用此格式
// 子类只需覆盖配置即可
// ============================================================

import type {
  AIProvider, AIProviderId, RegionAvailability, ModelOption,
  Message, ChatOptions, ChatResponse, StreamEvent, ConnectionTestResult
} from './types';

export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract readonly id: AIProviderId;
  abstract readonly name: string;
  abstract readonly nameEn: string;
  abstract readonly region: RegionAvailability;
  abstract readonly website: string;
  abstract readonly apiKeyGuideUrl: string;
  abstract readonly models: ModelOption[];
  abstract currentModel: string;

  protected abstract baseUrl: string;
  protected apiKey = '';

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** 子类可覆盖以自定义 headers */
  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  /** 子类可覆盖以自定义请求体 */
  protected buildRequestBody(messages: Message[], options?: ChatOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options?.model || this.currentModel,
      max_tokens: options?.maxTokens || 4096,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options?.temperature !== undefined) body.temperature = options.temperature;
    if (options?.stream) body.stream = true;
    return body;
  }

  async validateApiKey(key: string): Promise<boolean> {
    const saved = this.apiKey;
    this.apiKey = key;
    try {
      const result = await this.testConnection();
      return result.ok;
    } finally {
      this.apiKey = saved;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const testModel = this.models.find(m => m.tier === 'fast')?.id || this.currentModel;
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: testModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const status = res.status;
        let errorMsg = err.error?.message || `HTTP ${status}`;
        if (status === 401) errorMsg = `Invalid API Key / API Key 无效 (${status})`;
        else if (status === 403) errorMsg = `Access denied / 访问被拒绝 (${status}): ${errorMsg}`;
        else if (status === 429) errorMsg = `Rate limited / 请求频率过高 (${status})`;
        else if (status >= 500) errorMsg = `Server error / 服务端错误 (${status}): ${errorMsg}`;
        return { ok: false, latencyMs, error: errorMsg };
      }
      return { ok: true, latencyMs, model: testModel };
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
    const start = Date.now();
    const body = this.buildRequestBody(messages, options);

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      latencyMs: Date.now() - start,
    };
  }

  async *streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    const body = this.buildRequestBody(messages, { ...options, stream: true });

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      yield { type: 'error', error: err.error?.message || res.statusText };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'done' };
          return;
        }
        try {
          const event = JSON.parse(data);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) yield { type: 'text_delta', text: delta };
          if (event.usage) {
            yield {
              type: 'done',
              usage: {
                inputTokens: event.usage.prompt_tokens || 0,
                outputTokens: event.usage.completion_tokens || 0,
              },
            };
          }
        } catch { /* skip */ }
      }
    }
  }
}
