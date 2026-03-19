// ============================================================
// Anthropic Claude Provider
// 参考实现 — 其他提供商按此模式实现
// ============================================================

import type {
  AIProvider, AIProviderId, RegionAvailability, ModelOption,
  Message, ChatOptions, ChatResponse, StreamEvent, ConnectionTestResult
} from './types';

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
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
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
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
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
        return { ok: false, latencyMs, error: err.error?.message || `HTTP ${res.status}` };
      }
      return { ok: true, latencyMs, model: 'claude-haiku-4-5-20251001' };
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

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
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
    const model = options?.model || this.currentModel;

    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens || 4096,
      stream: true,
      messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;
    if (options?.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
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
        const data = line.slice(6);
        if (data === '[DONE]') {
          yield { type: 'done' };
          return;
        }
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.text) {
            yield { type: 'text_delta', text: event.delta.text };
          }
          if (event.type === 'message_delta' && event.usage) {
            yield {
              type: 'done',
              usage: {
                inputTokens: event.usage.input_tokens || 0,
                outputTokens: event.usage.output_tokens || 0,
              },
            };
          }
        } catch {
          // skip malformed events
        }
      }
    }
  }
}
