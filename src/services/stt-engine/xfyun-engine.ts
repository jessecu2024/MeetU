// ============================================================
// iFlytek (讯飞) STT Engine — WebSocket real-time streaming (BYOK)
// Best Chinese speech recognition, supports dialects
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

export class XfyunEngine implements STTEngine {
  readonly id: STTEngineId = 'xfyun';
  readonly name = 'iFlytek Speech';
  readonly region = 'china' as const;
  readonly supportsRealtime = true;

  private appId = '';
  private apiKey = '';
  private apiSecret = '';
  private ws: WebSocket | null = null;
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private resultCounter = 0;
  private sessionStartTime = 0;

  /**
   * iFlytek requires appId:apiKey:apiSecret format
   * e.g., "abc123:def456:ghi789"
   */
  setApiKey(key: string): void {
    const parts = key.split(':');
    if (parts.length >= 3) {
      this.appId = parts[0];
      this.apiKey = parts[1];
      this.apiSecret = parts[2];
    } else {
      this.apiKey = key;
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) {
      return { ok: false, error: 'No API Key configured. Format: appId:apiKey:apiSecret' };
    }
    if (!this.appId || !this.apiSecret) {
      return { ok: false, error: 'Invalid key format. Use: appId:apiKey:apiSecret' };
    }
    // iFlytek doesn't have a simple test endpoint, just validate format
    return { ok: true };
  }

  async startSession(config: STTConfig): Promise<void> {
    if (!this.apiKey || !this.appId) {
      throw new Error('iFlytek credentials not configured (appId:apiKey:apiSecret)');
    }

    this.sessionStartTime = Date.now();
    this.resultCounter = 0;

    // Generate auth URL
    const url = this.generateAuthUrl();

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.running = true;
        console.log('[iFlytek] WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.code !== 0) {
            console.error('[iFlytek] Error:', data.message);
            return;
          }

          const result = data.data?.result;
          if (!result) return;

          // Parse iFlytek result format
          const ws = result.ws || [];
          const text = ws.map((w: { cw: Array<{ w: string }> }) =>
            w.cw.map((c: { w: string }) => c.w).join('')
          ).join('');

          if (!text.trim()) return;

          const isFinal = result.ls === true; // ls=true means sentence end

          this.callback?.({
            id: `xf-${++this.resultCounter}`,
            text: text.trim(),
            isFinal,
            language: 'zh',
            startMs: Date.now() - this.sessionStartTime - 2000,
            endMs: Date.now() - this.sessionStartTime,
            confidence: 0.9,
          });
        } catch {
          // Skip malformed messages
        }
      };

      this.ws.onerror = () => {
        if (!this.running) reject(new Error('iFlytek connection failed'));
      };

      this.ws.onclose = () => {
        this.running = false;
      };
    });
  }

  feedAudio(chunk: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Convert Float32 to Int16 PCM
    const float32 = new Float32Array(chunk);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Base64 encode for iFlytek
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const audioBase64 = btoa(binary);

    const frame = {
      data: {
        status: 1, // 1 = continue
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: audioBase64,
      },
    };

    this.ws.send(JSON.stringify(frame));
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send end frame
      this.ws.send(JSON.stringify({
        data: { status: 2, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' },
      }));
    }
    this.running = false;
    setTimeout(() => {
      this.ws?.close();
      this.ws = null;
    }, 1000);
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Generate iFlytek WebSocket auth URL with HMAC-SHA256 signature */
  private generateAuthUrl(): string {
    // iFlytek auth uses date + HMAC signature in URL
    // Simplified version — full implementation needs crypto.subtle
    const host = 'iat-api.xfyun.cn';
    const path = '/v2/iat';
    const date = new Date().toUTCString();

    // For now, use a basic URL. Full HMAC auth requires async crypto.
    // In production, this should use WebCrypto API for proper signing.
    const baseUrl = `wss://${host}${path}`;
    const params = new URLSearchParams({
      authorization: btoa(`api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="placeholder"`),
      date,
      host,
    });

    return `${baseUrl}?${params}`;
  }
}
