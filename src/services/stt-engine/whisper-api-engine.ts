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
  // Ordering machinery for parallel transcription requests. Because
  // each segment's fetch runs in parallel, OpenAI's response order is
  // not the input order — a fast segment 2 can return before a slower
  // segment 1. To avoid mis-rendered transcripts and out-of-order
  // summaries, we keep `nextEmitMs` (the startMs we are waiting to
  // emit) and buffer any result that arrives early in `pending`.
  // A `null` value in `pending` is a "skip" marker for failed/empty
  // segments so the cursor still advances past them.
  private nextEmitMs = 0;
  private pending = new Map<number, TranscriptResult | null>();
  // Promises for every transcribeSegment call currently in flight.
  // stopSession awaits Promise.allSettled over this set so the final
  // segment's network round-trip completes and reaches deliverSegment
  // BEFORE running=false makes fireResult swallow it.
  private inflightTranscriptions = new Set<Promise<void>>();
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
    this.nextEmitMs = 0;
    this.pending.clear();
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

    const p = this.transcribeSegment(chunk, startMs, endMs).catch((err) => {
      console.error('[Whisper] segment transcription failed:', err);
      // Even on uncaught throw, advance the cursor so subsequent
      // segments can flush. transcribeSegment already calls
      // markSegmentEmpty on its own error paths, but this catch
      // protects against unexpected throws.
      this.markSegmentEmpty(startMs);
    });
    this.inflightTranscriptions.add(p);
    void p.finally(() => this.inflightTranscriptions.delete(p));
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
      this.markSegmentEmpty(startMs);
      return;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[Whisper] HTTP ${res.status}: ${detail.substring(0, 200)}`);
      this.markSegmentEmpty(startMs);
      return;
    }

    let data: { text?: string; language?: string };
    try {
      data = await res.json();
    } catch {
      console.warn('[Whisper] malformed JSON response');
      this.markSegmentEmpty(startMs);
      return;
    }

    const text = (data.text || '').trim();
    if (!text) {
      this.markSegmentEmpty(startMs);
      return;
    }

    // Reject Whisper hallucinations on silent segments. The model has
    // known "Thank you for watching" / "字幕组" failure modes when fed
    // mostly-silence audio.
    if (looksLikeHallucination(text)) {
      console.log('[Whisper] dropping likely-hallucination text');
      this.markSegmentEmpty(startMs);
      return;
    }

    this.deliverSegmentResult({
      id: `whisper-${++this.resultCounter}`,
      text,
      isFinal: true,
      language: data.language || undefined,
      startMs,
      endMs,
      confidence: 0.9, // Whisper does not return per-segment confidence
    });
  }

  /**
   * Emit a transcript in startMs order. Because per-segment fetches run
   * in parallel, OpenAI's response order is not the input order — a
   * fast segment 2 can return before a slower segment 1. We buffer
   * early arrivals and only fire the callback once the cursor reaches
   * their slot.
   */
  private deliverSegmentResult(result: TranscriptResult): void {
    if (result.startMs < this.nextEmitMs) {
      // Result came after we already moved past its slot (this would
      // imply the segment ID was reused or a startMs was duplicated).
      // Emit immediately rather than dropping — out-of-order is better
      // than silently losing transcript content.
      this.fireResult(result);
      return;
    }
    this.pending.set(result.startMs, result);
    this.drainPending();
  }

  /**
   * Mark a segment slot as having no transcript (failed fetch, empty
   * response, or hallucination). Without this, a permanent failure on
   * one segment would block every later segment forever because the
   * cursor would never advance past the failed slot.
   */
  private markSegmentEmpty(startMs: number): void {
    if (startMs < this.nextEmitMs) return; // already past it
    this.pending.set(startMs, null);
    this.drainPending();
  }

  private drainPending(): void {
    while (this.pending.has(this.nextEmitMs)) {
      const next = this.pending.get(this.nextEmitMs);
      this.pending.delete(this.nextEmitMs);
      if (next) this.fireResult(next);
      this.nextEmitMs += SEGMENT_DURATION_MS;
    }
  }

  private fireResult(result: TranscriptResult): void {
    if (!this.running) return; // session may have ended mid-flight
    this.callback?.(result);
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    // Drain every transcription request that is still in flight BEFORE
    // flipping `running` to false. Without this drain, fireResult would
    // see `running=false` for any segment whose fetch had not yet
    // returned and silently skip emitting it — losing transcripts for
    // both slow earlier segments and the final segment that came in
    // during the stop sequence.
    if (this.inflightTranscriptions.size > 0) {
      await Promise.allSettled(Array.from(this.inflightTranscriptions));
    }
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
  // For letter-based patterns we strip trailing `.` / `!` so that
  // "Thank you", "Thank you.", "Thank you!" all collapse to the same
  // normalized form. We do NOT strip punctuation from the
  // punctuation-only cases ("..." / ". .") — those are checked against
  // `trimmed` directly below.
  const normalized = trimmed.toLowerCase().replace(/[!.]+$/, '');
  return (
    // English silent-segment hallucinations
    normalized === 'thank you' ||
    normalized === 'thanks for watching' ||
    normalized === 'thank you for watching' ||
    normalized === 'thank you so much for watching' ||
    normalized === 'thanks for watching everyone' ||
    normalized === 'thanks for watching the video' ||
    normalized === 'thank you very much' ||
    // Punctuation-only emissions Whisper produces on silence
    trimmed === '...' ||
    trimmed === '. .' ||
    trimmed === '。' ||
    // Common Chinese-subtitle hallucinations Whisper emits on silence.
    // The `\s*` is intentional: Whisper inserts spaces between Han and
    // Latin in its output ("字幕 by ..."), and the bare `字幕组` form
    // has no space.
    /^字幕\s*(组|by|提供)/i.test(trimmed) ||
    /^请订阅|^请关注/.test(trimmed)
  );
}
