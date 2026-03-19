// ============================================================
// DeepSeek Provider（国内可用）
// 使用 OpenAI 兼容 API 格式
// ============================================================

import type {
  AIProvider, AIProviderId, RegionAvailability, ModelOption,
  Message, ChatOptions, ChatResponse, StreamEvent, ConnectionTestResult
} from './types';

export class DeepSeekProvider implements AIProvider {
  readonly id: AIProviderId = 'deepseek';
  readonly name = 'DeepSeek（深度求索）';
  readonly nameEn = 'DeepSeek';
  readonly region: RegionAvailability = 'both';  // 国内外都可用
  readonly website = 'https://www.deepseek.com';
  readonly apiKeyGuideUrl = 'https://platform.deepseek.com/api_keys';

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
  private apiKey = '';
  private baseUrl = 'https://api.deepseek.com';

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async validateApiKey(key: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
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
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, latencyMs, error: err.error?.message || `HTTP ${res.status}` };
      }
      return { ok: true, latencyMs, model: 'deepseek-chat' };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : '网络错误',
      };
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.currentModel;
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`DeepSeek API error: ${err.error?.message || res.statusText}`);
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
    const model = options?.model || this.currentModel;

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    };
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
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
          if (delta) {
            yield { type: 'text_delta', text: delta };
          }
        } catch {
          // skip
        }
      }
    }
  }
}
