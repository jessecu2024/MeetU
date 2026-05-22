// ============================================================
// OpenAI Whisper API STT Engine (BYOK)
//
// Whisper's `/v1/audio/transcriptions` endpoint is REST: each request
// carries a single complete audio file. The capture layer therefore
// drives this engine in **segment mode** — it spawns a fresh
// MediaRecorder per `segmentDurationMs` window and hands us one
// independently-decodable webm/opus file per window via `feedAudio`.
// We POST that file as-is (Whisper accepts webm) and emit a transcript
// once OpenAI responds.
//
// The 5-second default is a balance: long enough for word/phrase
// context to land on the same segment (better accuracy than 3s), short
// enough to keep end-to-end latency in the 5–7s range. Pricing is per
// audio second so segment length does not affect cost.
// ============================================================

import type {
  STTEngine, STTEngineId, STTConfig, TranscriptResult, AudioDeliveryMode,
} from './types';

const SEGMENT_DURATION_MS = 5000;
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

export class WhisperAPIEngine implements STTEngine {
  readonly id: STTEngineId = 'whisper_api';
  readonly name = 'Whisper API (OpenAI)';
  readonly region = 'global' as const;
  readonly supportsRealtime = false; // segment-based, not streaming

  readonly audioMode: AudioDeliveryMode = 'segment';
  readonly segmentDurationMs = SEGMENT_DURATION_MS;

  private apiKey = '';
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private resultCounter = 0;
  // Tracks the running offset (in ms from session start) of the next
  // segment we will receive, so each transcript carries a startMs that
  // matches its real position in the meeting timeline.
  private nextSegmentOffsetMs = 0;
  // Override-able for tests; the runtime always feeds webm/opus.
  private readonly mimeType = 'audio/webm';

  setApiKey(key: string): void { this.apiKey = key; }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey) return { ok: false, error: 'No API Key configured' };
    try {
      // Cheap auth check: list models. The transcription endpoint has
      // no no-op ping; /v1/models with the same bearer confirms the key
      // is valid without spending audio-second credit.
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Invalid API Key (HTTP ${res.status}) / API Key 无效` };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      return { ok: false, error: `Network error: ${msg} / 网络错误，请检查 VPN` };
    }
  }

  async startSession(_config: STTConfig): Promise<void> {
    if (!this.apiKey) throw new Error('Whisper API Key not configured');
    this.running = true;
    this.nextSegmentOffsetMs = 0;
    this.resultCounter = 0;
  }

  /**
   * Receives one complete webm/opus file per `segmentDurationMs` window.
   * Fire-and-forget: we don't block capture on the network round-trip,
   * but each transcript carries its own `startMs` so out-of-order
   * arrivals (a slower OpenAI response after a faster one) still render
   * in the correct meeting timeline.
   */
  feedAudio(chunk: ArrayBuffer): void {
    if (!this.running || chunk.byteLength === 0) return;

    // Snapshot the segment's position in the meeting BEFORE async work.
    const startMs = this.nextSegmentOffsetMs;
    const endMs = startMs + SEGMENT_DURATION_MS;
    this.nextSegmentOffsetMs += SEGMENT_DURATION_MS;

    this.transcribeSegment(chunk, startMs, endMs).catch((err) => {
      console.error('[Whisper] segment transcription failed:', err);
    });
  }

  private async transcribeSegment(buffer: ArrayBuffer, startMs: number, endMs: number): Promise<void> {
    const blob = new Blob([buffer], { type: this.mimeType });
    const formData = new FormData();
    formData.append('file', blob, 'segment.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    let res: Response;
    try {
      res = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        body: formData,
      });
    } catch (err) {
      console.error('[Whisper] network error:', err);
      return;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[Whisper] HTTP ${res.status}: ${detail.substring(0, 200)}`);
      return;
    }

    let data: { text?: string; language?: string };
    try {
      data = await res.json();
    } catch {
      console.warn('[Whisper] malformed JSON response');
      return;
    }

    const text = (data.text || '').trim();
    if (!text) return;

    // Reject Whisper hallucinations on silent segments. The model has
    // known "Thank you for watching" / "字幕组" failure modes when fed
    // mostly-silence audio.
    if (looksLikeHallucination(text)) {
      console.log('[Whisper] dropping likely-hallucination text');
      return;
    }

    if (!this.running) return; // session may have ended mid-flight

    this.callback?.({
      id: `whisper-${++this.resultCounter}`,
      text,
      isFinal: true,
      language: data.language || undefined,
      startMs,
      endMs,
      confidence: 0.9, // Whisper does not return per-segment confidence
    });
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Heuristic filter for Whisper hallucination patterns. Whisper is known
 * to confidently transcribe silence as a small set of recurring strings
 * (the "thank you for watching" failure mode and Chinese-subtitle
 * variants). Exported for unit testing.
 */
export function looksLikeHallucination(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  return (
    lower === 'thank you.' ||
    lower === 'thanks for watching!' ||
    lower === 'thanks for watching.' ||
    lower === '. .' ||
    lower === '...' ||
    trimmed === '。' ||
    // Common Chinese-subtitle hallucinations Whisper emits on silence.
    // The `\s*` is intentional: Whisper inserts spaces between Han and
    // Latin in its output ("字幕 by ..."), and the bare `字幕组` form
    // has no space.
    /^字幕\s*(组|by|提供)/i.test(trimmed) ||
    /^请订阅|^请关注/.test(trimmed)
  );
}
