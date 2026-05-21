// ============================================================
// OpenAI Whisper API STT Engine (BYOK)
// Non-streaming: accumulates 5s audio segments, sends via REST
// POST https://api.openai.com/v1/audio/transcriptions
// ============================================================

import type { STTEngine, STTEngineId, STTConfig, TranscriptResult } from './types';

const SEGMENT_DURATION_MS = 5000; // 5 second segments

export class WhisperAPIEngine implements STTEngine {
  readonly id: STTEngineId = 'whisper_api';
  readonly name = 'Whisper API (OpenAI)';
  readonly region = 'global' as const;
  readonly supportsRealtime = false; // Segment-based, not true real-time

  private apiKey = '';
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private audioBuffer: Float32Array[] = [];
  private segmentInterval: ReturnType<typeof setInterval> | null = null;
  private resultCounter = 0;
  private sessionStartTime = 0;
  private sampleRate = 16000;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'No API Key configured' };
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async startSession(_config: STTConfig): Promise<void> {
    // Defense in depth (mirrors xfyun-engine.startSession). The production
    // audio pipeline emits webm/opus chunks via MediaRecorder, but this
    // engine's feedAudio + processSegment assume PCM Float32 (see line 59),
    // so any session that gets this far will silently send re-encoded
    // garbage WAV to OpenAI and either receive nothing or hallucinated
    // transcripts. Refuse to start until the engine is reworked to accept
    // webm/opus segments directly.
    //
    // isSelectableSTTEngine already blocks whisper_api from being picked
    // through SettingsModal, OnboardingWizard, sttRegistry.getConfiguredEngine
    // and the store guards, but a future direct caller (a script, a test,
    // a feature flag) must not be able to bypass that gate either.
    throw new Error(
      'Whisper API live transcription is not yet supported in this build: ' +
      'the engine expects PCM Float32 input but the production capture ' +
      'pipeline produces webm/opus, so transcripts would be invalid. ' +
      '/ Whisper API 实时转写在当前版本暂不支持：引擎按 PCM Float32 解析' +
      '但生产音频管线输出 webm/opus，会产生无效转写。'
    );

    // The original session-start logic is intentionally unreachable below
    // until the audio-format mismatch is fixed. Preserved so the eventual
    // fix is a removal of the throw above, not a rewrite.
    /* istanbul ignore next */
    if (!this.apiKey) throw new Error('Whisper API Key not configured');
    this.running = true;
    this.sessionStartTime = Date.now();
    this.sampleRate = _config.sampleRate || 16000;
    this.audioBuffer = [];
    this.resultCounter = 0;
    this.segmentInterval = setInterval(() => {
      this.processSegment();
    }, SEGMENT_DURATION_MS);
  }

  feedAudio(chunk: ArrayBuffer): void {
    if (!this.running) return;
    this.audioBuffer.push(new Float32Array(chunk));
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;
    if (this.segmentInterval) {
      clearInterval(this.segmentInterval);
      this.segmentInterval = null;
    }
    // Process remaining audio
    await this.processSegment();
    this.audioBuffer = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Convert buffered audio to WAV and send to Whisper API */
  private async processSegment(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    const chunks = this.audioBuffer.splice(0);
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalLength < 100) return; // Skip very short segments

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Encode as WAV
    const wavBlob = this.encodeWAV(merged);
    const segmentStart = Date.now() - this.sessionStartTime - SEGMENT_DURATION_MS;

    try {
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: formData,
      });

      if (!res.ok) {
        console.error('[Whisper] API error:', res.status);
        return;
      }

      const data = await res.json();
      if (data.text?.trim()) {
        this.callback?.({
          id: `whisper-${++this.resultCounter}`,
          text: data.text.trim(),
          isFinal: true,
          language: data.language || undefined,
          startMs: Math.max(0, segmentStart),
          endMs: Date.now() - this.sessionStartTime,
          confidence: 0.9, // Whisper doesn't return confidence
        });
      }
    } catch (err) {
      console.error('[Whisper] Request failed:', err);
    }
  }

  /** Encode Float32 PCM data as WAV blob */
  private encodeWAV(samples: Float32Array): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataLength = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // PCM data
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}
