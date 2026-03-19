// ============================================================
// Deepgram STT Engine — Real-time WebSocket streaming (BYOK)
// wss://api.deepgram.com/v1/listen
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

export class DeepgramEngine implements STTEngine {
  readonly id: STTEngineId = 'deepgram';
  readonly name = 'Deepgram';
  readonly region = 'global' as const;
  readonly supportsRealtime = true;

  private apiKey = '';
  private ws: WebSocket | null = null;
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private resultCounter = 0;
  private sessionStartTime = 0;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'No API Key configured' };
    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { 'Authorization': `Token ${this.apiKey}` },
      });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async startSession(config: STTConfig): Promise<void> {
    if (!this.apiKey) throw new Error('Deepgram API Key not configured');

    this.sessionStartTime = Date.now();
    this.resultCounter = 0;

    const params = new URLSearchParams({
      model: 'nova-2',
      punctuate: 'true',
      diarize: String(config.enableDiarization ?? true),
      interim_results: String(config.interimResults ?? true),
      language: config.language || 'multi',
      sample_rate: String(config.sampleRate || 16000),
      encoding: 'linear16',
      channels: '1',
    });

    const url = `wss://api.deepgram.com/v1/listen?${params}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, ['token', this.apiKey]);

      this.ws.onopen = () => {
        this.running = true;
        console.log('[Deepgram] WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const alt = data.channel.alternatives[0];
            if (!alt.transcript) return;

            const result: TranscriptResult = {
              id: `dg-${++this.resultCounter}`,
              text: alt.transcript,
              isFinal: data.is_final ?? false,
              speaker: alt.words?.[0]?.speaker !== undefined
                ? `Speaker ${alt.words[0].speaker}`
                : undefined,
              language: data.channel?.detected_language || undefined,
              startMs: Math.round((data.start || 0) * 1000),
              endMs: Math.round(((data.start || 0) + (data.duration || 0)) * 1000),
              confidence: alt.confidence || 0,
            };

            this.callback?.(result);
          }
        } catch {
          // Skip malformed messages
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Deepgram] WebSocket error:', err);
        if (!this.running) reject(new Error('Deepgram connection failed'));
      };

      this.ws.onclose = () => {
        this.running = false;
        console.log('[Deepgram] WebSocket closed');
      };
    });
  }

  feedAudio(chunk: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Convert Float32 to Int16 for Deepgram (expects linear16)
    const float32 = new Float32Array(chunk);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    this.ws.send(int16.buffer);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;
    if (this.ws) {
      // Send close message per Deepgram protocol
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
      this.ws.close();
      this.ws = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
