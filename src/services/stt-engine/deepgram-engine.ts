// ============================================================
// Deepgram STT Engine — Real-time streaming via main process IPC
// WebSocket runs in Electron main process to bypass CORS
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

export class DeepgramEngine implements STTEngine {
  readonly id: STTEngineId = 'deepgram';
  readonly name = 'Deepgram';
  readonly region = 'global' as const;
  readonly supportsRealtime = true;

  private apiKey = '';
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private resultCounter = 0;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'No API Key configured' };

    // Route through main process IPC to bypass CORS
    const api = (window as unknown as { electronAPI?: {
      stt?: { testConnection?: (id: string, key: string) => Promise<{ ok: boolean; error?: string }> }
    } }).electronAPI;

    if (api?.stt?.testConnection) {
      return api.stt.testConnection('deepgram', this.apiKey);
    }

    // Fallback: direct fetch (may fail due to CORS)
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

    this.resultCounter = 0;

    const params: Record<string, string> = {
      model: 'nova-2',
      punctuate: 'true',
      diarize: String(config.enableDiarization ?? true),
      interim_results: String(config.interimResults ?? true),
      language: config.language || 'multi',
      sample_rate: String(config.sampleRate || 16000),
      encoding: 'linear16',
      channels: '1',
    };

    const api = (window as unknown as { electronAPI?: {
      stt?: {
        startSession?: (id: string, key: string, params: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
        onTranscript?: (cb: (result: { text: string; isFinal: boolean; speaker?: string; language?: string; startMs: number; endMs: number; confidence: number }) => void) => void;
        onError?: (cb: (error: string) => void) => void;
        onClosed?: (cb: () => void) => void;
      }
    } }).electronAPI;

    if (!api?.stt?.startSession) {
      throw new Error('Electron IPC not available — cannot start Deepgram session');
    }

    // Listen for transcripts from main process
    api.stt.onTranscript?.((result) => {
      if (!this.callback || !this.running) return;
      this.callback({
        id: `dg-${++this.resultCounter}`,
        ...result,
      });
    });

    api.stt.onError?.((error) => {
      console.error('[Deepgram] Error from main process:', error);
    });

    api.stt.onClosed?.(() => {
      console.log('[Deepgram] Session closed by main process');
      this.running = false;
    });

    // Start WebSocket in main process
    const result = await api.stt.startSession('deepgram', this.apiKey, params);
    if (!result.ok) {
      throw new Error(result.error || 'Deepgram connection failed');
    }

    this.running = true;
  }

  feedAudio(chunk: ArrayBuffer): void {
    if (!this.running) return;

    // Convert Float32 to Int16 for Deepgram (expects linear16)
    const float32 = new Float32Array(chunk);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Send to main process WebSocket
    const api = (window as unknown as { electronAPI?: {
      stt?: { feedAudio?: (buf: ArrayBuffer) => void }
    } }).electronAPI;

    api?.stt?.feedAudio?.(int16.buffer);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;

    const api = (window as unknown as { electronAPI?: {
      stt?: { stopSession?: () => Promise<{ ok: boolean }> }
    } }).electronAPI;

    await api?.stt?.stopSession?.();
  }

  isRunning(): boolean {
    return this.running;
  }
}
