// ============================================================
// Local Whisper Engine — Offline STT using whisper.cpp
// MIT licensed, zero network dependency, best privacy
//
// Current status: Stub implementation
// Full implementation requires whisper.cpp WASM or native binary
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

export class LocalWhisperEngine implements STTEngine {
  readonly id: STTEngineId = 'local_whisper';
  readonly name = 'Local Whisper (Offline)';
  readonly region = 'local' as const;
  readonly supportsRealtime = false; // Processes in segments

  private running = false;
  private callback: ((result: TranscriptResult) => void) | null = null;
  private modelLoaded = false;

  setApiKey(): void { /* no API key needed */ }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    // Check if whisper model is available
    // In future: check for WASM module or whisper binary
    return {
      ok: false,
      error: 'Local Whisper not yet available. whisper.cpp integration coming soon. ' +
             '本地 Whisper 尚未可用，whisper.cpp 集成即将推出。',
    };
  }

  async startSession(_config: STTConfig): Promise<void> {
    if (!this.modelLoaded) {
      throw new Error(
        'Local Whisper model not loaded. Please download a model first, or use an online STT engine. / ' +
        '本地 Whisper 模型未加载。请先下载模型，或使用在线 STT 引擎。'
      );
    }
    this.running = true;
  }

  feedAudio(_chunk: ArrayBuffer): void {
    // TODO: Buffer audio and process with whisper.cpp
    // When implemented:
    // 1. Accumulate audio into 30-second segments
    // 2. Feed segment to whisper.cpp WASM/native
    // 3. Emit transcript results
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;
    // TODO: Process remaining audio buffer
  }

  isRunning(): boolean {
    return this.running;
  }
}
