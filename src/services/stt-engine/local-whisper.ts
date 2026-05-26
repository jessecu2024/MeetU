// ============================================================
// Local Whisper Engine — Offline STT via smart-whisper (whisper.cpp)
// MIT licensed, zero network dependency, best privacy.
//
// whisper.cpp is not a streaming recognizer: it transcribes a whole
// audio buffer at once. So this engine drives capture in `pcm-stream`
// mode (16-kHz mono Float32 frames, the same pipeline iFlytek uses)
// and accumulates frames into ~WINDOW_SECONDS-long windows. Each full
// window is shipped over IPC to the main process — where the native
// whisper.cpp binding lives — and transcribed; the text comes back and
// is emitted as one final TranscriptResult per window.
//
// Why windows (not the whole meeting): whisper memory + latency scale
// with audio length, and the user wants captions during the meeting,
// not only at the end. ~12 s balances word-context accuracy against
// caption latency, similar in spirit to the Whisper API engine's 5 s
// segments (longer here because local inference has no per-request
// network overhead and a bit more context helps a smaller model).
//
// All heavy work (model load, inference) is in the main process; this
// renderer class only buffers, dispatches IPC, and orders results.
// ============================================================

import type {
  STTEngine, STTEngineId, STTConfig, TranscriptResult, AudioDeliveryMode,
} from './types';

const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 12;
const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS;
const WINDOW_MS = Math.round((WINDOW_SAMPLES / SAMPLE_RATE) * 1000);

export class LocalWhisperEngine implements STTEngine {
  readonly id: STTEngineId = 'local_whisper';
  readonly name = 'Local Whisper (Offline)';
  readonly region = 'local' as const;
  readonly supportsRealtime = false; // window-based, not streaming

  // Reuse the PCM pipeline: capture pushes 16-kHz mono Float32 frames.
  readonly audioMode: AudioDeliveryMode = 'pcm-stream';

  private running = false;
  private stopping = false; // set at the top of stopSession; makes stop idempotent
  private callback: ((result: TranscriptResult) => void) | null = null;
  private model = 'base';
  private language = 'auto';

  // Accumulates Float32 samples until we have a full window.
  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private resultCounter = 0;
  private windowOffsetMs = 0; // start time of the NEXT window we submit
  // In-flight transcription promises. stopSession awaits all of them
  // so the final window's text reaches subscribers before teardown.
  private inflight = new Set<Promise<void>>();
  // Emit windows strictly in timeline order. Each window is tagged with
  // its start offset; results that resolve early are buffered until all
  // earlier windows have emitted. We also remember each window's
  // duration so a `null` (empty/silent) marker advances the cursor by
  // the right amount.
  private nextEmitMs = 0;
  private pending = new Map<number, { result: TranscriptResult | null; durationMs: number }>();

  setApiKey(): void { /* no API key — fully local */ }

  /** Choose which downloaded ggml model to load (e.g. 'base', 'small.en'). */
  setModel(model: string): void {
    if (model) this.model = model;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const probe = await window.electronAPI?.audio.localWhisper.probe();
    if (!probe) {
      return { ok: false, error: 'Local Whisper IPC unavailable (preload missing). / 本地 Whisper IPC 不可用' };
    }
    if (!probe.available) {
      return { ok: false, error: probe.reason || 'Local Whisper native module unavailable. / 本地 Whisper 原生模块不可用' };
    }
    if (!probe.hasAnyModel) {
      return {
        ok: false,
        error: 'No Whisper model downloaded. Download one in Settings → Speech Engine. / 尚未下载 Whisper 模型，请在 设置 → 语音引擎 中下载',
      };
    }
    return { ok: true };
  }

  async startSession(config: STTConfig): Promise<void> {
    this.language = config.language || 'auto';
    this.buffer = [];
    this.bufferedSamples = 0;
    this.resultCounter = 0;
    this.windowOffsetMs = 0;
    this.nextEmitMs = 0;
    this.pending.clear();
    this.inflight.clear();
    this.stopping = false;

    const res = await window.electronAPI?.audio.localWhisper.start({ model: this.model });
    if (!res?.ok) {
      throw new Error(res?.error || 'Failed to start Local Whisper session / 本地 Whisper 会话启动失败');
    }
    this.running = true;
  }

  feedAudio(chunk: ArrayBuffer): void {
    if (!this.running) return;
    // pcm-stream delivers Float32 frames packaged as ArrayBuffer.
    const frame = new Float32Array(chunk);
    if (frame.length === 0) return;
    this.buffer.push(frame);
    this.bufferedSamples += frame.length;
    // Emit as many FIXED-size windows as we now have. A single large
    // frame (or a scheduler stall that batches several frames) must not
    // produce one giant >WINDOW window — that would balloon latency and
    // native workload. We slice exactly WINDOW_SAMPLES per window and
    // keep the remainder buffered for the next one.
    while (this.bufferedSamples >= WINDOW_SAMPLES) {
      this.submitWindow(this.takeSamples(WINDOW_SAMPLES));
    }
  }

  /** Submit one window (any length) for transcription. */
  private submitWindow(windowed: Float32Array): void {
    if (windowed.length === 0) return;
    const offsetMs = this.windowOffsetMs;
    const durationMs = Math.round((windowed.length / SAMPLE_RATE) * 1000);
    this.windowOffsetMs += durationMs;

    const work = (async () => {
      try {
        // NOTE: ipcRenderer.invoke structured-clones the buffer (no
        // transfer list), so this is a copy across the boundary, not a
        // zero-copy transfer. windowed is freshly allocated, so .buffer
        // is a plain ArrayBuffer (never SharedArrayBuffer) — cast safe.
        const res = await window.electronAPI?.audio.localWhisper.transcribe(
          windowed.buffer as ArrayBuffer, { language: this.language },
        );
        const text = res?.ok ? (res.text || '').trim() : '';
        if (res && !res.ok) {
          console.error('[STT] Local Whisper transcribe failed:', res.error);
        }
        this.deliver(offsetMs, durationMs, text);
      } catch (err) {
        console.error('[STT] Local Whisper transcribe threw:', err);
        this.deliver(offsetMs, durationMs, ''); // advance the cursor
      }
    })();
    this.inflight.add(work);
    void work.finally(() => this.inflight.delete(work));
  }

  /**
   * Remove and return exactly `n` samples from the front of the buffered
   * frames, leaving any remainder buffered. `n` must be ≤ bufferedSamples.
   */
  private takeSamples(n: number): Float32Array {
    const out = new Float32Array(n);
    let filled = 0;
    while (filled < n && this.buffer.length > 0) {
      const head = this.buffer[0];
      const need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.buffer.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.buffer[0] = head.subarray(need); // keep the tail buffered
        filled += need;
      }
    }
    this.bufferedSamples -= filled;
    return out;
  }

  /**
   * Emit windows strictly in timeline order. A window that resolves
   * early is buffered until all earlier windows have been emitted, so
   * transcripts and downstream summaries never render out of order.
   * Empty text is recorded as a skip marker (result === null) so the
   * cursor still advances past silent windows by their real duration.
   */
  private deliver(offsetMs: number, durationMs: number, text: string): void {
    const result: TranscriptResult | null = text
      ? {
          id: `lw-${this.resultCounter++}`,
          text,
          isFinal: true,
          language: this.language === 'auto' ? undefined : this.language,
          startMs: offsetMs,
          endMs: offsetMs + durationMs,
          confidence: 0.9,
        }
      : null;
    this.pending.set(offsetMs, { result, durationMs });

    // Drain in-order from the emit cursor.
    while (this.pending.has(this.nextEmitMs)) {
      const { result: r, durationMs: d } = this.pending.get(this.nextEmitMs)!;
      this.pending.delete(this.nextEmitMs);
      if (r && this.callback) this.callback(r);
      this.nextEmitMs += d > 0 ? d : WINDOW_MS;
    }
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    // Idempotent: a fatal-error stop and a user stop can both fire.
    if (this.stopping) return;
    this.stopping = true;
    this.running = false;
    // Flush any partial trailing window so the meeting's last words
    // aren't dropped. takeSamples drains the buffer fully.
    if (this.bufferedSamples > 0) {
      this.submitWindow(this.takeSamples(this.bufferedSamples));
    }
    // Wait for every in-flight transcription to land + emit.
    if (this.inflight.size > 0) {
      await Promise.allSettled(Array.from(this.inflight));
    }
    try { await window.electronAPI?.audio.localWhisper.stop(); } catch { /* ignore */ }
  }

  isRunning(): boolean {
    return this.running;
  }
}
