// Tests for the LocalWhisperEngine renderer class: windowing of the
// pcm-stream into ~12 s buffers, in-timeline-order emission of results
// that resolve out of order, trailing-window flush on stop, and the
// testConnection probe states. The main-process transcription is faked
// via a stubbed window.electronAPI.audio.localWhisper.
import { describe, it, expect, vi } from 'vitest';
import { LocalWhisperEngine } from './local-whisper';
import type { TranscriptResult } from './types';

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = SAMPLE_RATE * 12;

type TranscribeResolver = (text: string) => void;

interface Stub {
  probe: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  transcribeCalls: Array<{ samples: number; resolve: TranscribeResolver }>;
}

function installStub(opts: { available?: boolean; hasAnyModel?: boolean; autoText?: (i: number) => string } = {}): Stub {
  const transcribeCalls: Stub['transcribeCalls'] = [];
  let i = 0;
  const stub: Stub = {
    probe: vi.fn(async () => ({
      available: opts.available ?? true,
      hasAnyModel: opts.hasAnyModel ?? true,
      models: [],
      reason: opts.available === false ? 'unavailable' : undefined,
    })),
    start: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    transcribeCalls,
  };
  const transcribe = vi.fn((pcm: ArrayBuffer) => {
    const idx = i++;
    return new Promise((resolve) => {
      const r: TranscribeResolver = (text) => resolve({ ok: true, text });
      transcribeCalls.push({ samples: new Float32Array(pcm).length, resolve: r });
      // Auto-resolve mode for tests that don't need manual ordering control.
      if (opts.autoText) r(opts.autoText(idx));
    });
  });
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: { audio: { localWhisper: {
      probe: stub.probe,
      start: stub.start,
      stop: stub.stop,
      transcribe,
      downloadModel: vi.fn(),
      onDownloadProgress: vi.fn(() => () => {}),
    } } },
  };
  return stub;
}

function frame(n: number): ArrayBuffer {
  return new Float32Array(n).fill(0.1).buffer; // RMS 0.1 — well above the silence gate
}

function silentFrame(n: number): ArrayBuffer {
  return new Float32Array(n).fill(0.001).buffer; // RMS 0.001 — below the 0.006 gate
}

describe('LocalWhisperEngine.testConnection', () => {
  it('fails when the native module is unavailable', async () => {
    installStub({ available: false });
    const e = new LocalWhisperEngine();
    const r = await e.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unavailable|不可用/);
  });

  it('fails when no model is downloaded', async () => {
    installStub({ available: true, hasAnyModel: false });
    const e = new LocalWhisperEngine();
    const r = await e.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/model/i);
  });

  it('passes when available and a model is present', async () => {
    installStub({ available: true, hasAnyModel: true });
    const e = new LocalWhisperEngine();
    expect(await e.testConnection()).toEqual({ ok: true });
  });
});

describe('LocalWhisperEngine windowing', () => {
  it('does not transcribe until a full window has accumulated', async () => {
    const stub = installStub({ autoText: () => 'x' });
    const e = new LocalWhisperEngine();
    await e.startSession({ sampleRate: SAMPLE_RATE });
    // Feed just under one window.
    e.feedAudio(frame(WINDOW_SAMPLES - 1000));
    expect(stub.transcribeCalls.length).toBe(0);
    // Cross the threshold.
    e.feedAudio(frame(2000));
    expect(stub.transcribeCalls.length).toBe(1);
    expect(stub.transcribeCalls[0].samples).toBeGreaterThanOrEqual(WINDOW_SAMPLES);
  });

  it('emits one final transcript per window', async () => {
    installStub({ autoText: (i) => `window ${i}` });
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES));
    e.feedAudio(frame(WINDOW_SAMPLES));
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['window 0', 'window 1']);
    expect(results.every(r => r.isFinal)).toBe(true);
  });

  it('emits in timeline order even when later windows resolve first', async () => {
    const stub = installStub(); // manual resolve
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES)); // window 0
    e.feedAudio(frame(WINDOW_SAMPLES)); // window 1
    expect(stub.transcribeCalls.length).toBe(2);
    // Resolve window 1 BEFORE window 0.
    stub.transcribeCalls[1].resolve('second');
    await Promise.resolve(); await Promise.resolve();
    expect(results).toEqual([]); // nothing emitted — waiting for window 0
    stub.transcribeCalls[0].resolve('first');
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['first', 'second']);
    // startMs strictly increasing.
    expect(results[1].startMs).toBeGreaterThan(results[0].startMs);
  });

  it('flushes a partial trailing window on stop', async () => {
    installStub({ autoText: () => 'tail' });
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(5000)); // well under a window
    expect(results.length).toBe(0);
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['tail']);
  });

  it('skips empty/silent windows without emitting but keeps the cursor advancing', async () => {
    const stub = installStub();
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES)); // window 0 -> empty
    e.feedAudio(frame(WINDOW_SAMPLES)); // window 1 -> text
    stub.transcribeCalls[0].resolve('');       // silent
    stub.transcribeCalls[1].resolve('after silence');
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['after silence']);
  });

  it('ignores feedAudio before startSession / after stop', async () => {
    installStub({ autoText: () => 'x' });
    const e = new LocalWhisperEngine();
    e.feedAudio(frame(WINDOW_SAMPLES)); // not running yet
    expect(e.isRunning()).toBe(false);
    await e.startSession({ sampleRate: SAMPLE_RATE });
    await e.stopSession();
    const stub2 = (globalThis as unknown as { window: { electronAPI: { audio: { localWhisper: { transcribe: ReturnType<typeof vi.fn> } } } } }).window;
    const before = stub2.electronAPI.audio.localWhisper.transcribe.mock.calls.length;
    e.feedAudio(frame(WINDOW_SAMPLES)); // after stop
    expect(stub2.electronAPI.audio.localWhisper.transcribe.mock.calls.length).toBe(before);
  });

  it('throws if start returns ok:false (e.g. model missing)', async () => {
    installStub();
    const stubWin = (globalThis as unknown as { window: { electronAPI: { audio: { localWhisper: { start: ReturnType<typeof vi.fn> } } } } }).window;
    stubWin.electronAPI.audio.localWhisper.start.mockResolvedValueOnce({ ok: false, error: 'model not downloaded: base' });
    const e = new LocalWhisperEngine();
    await expect(e.startSession({ sampleRate: SAMPLE_RATE })).rejects.toThrow(/model not downloaded/);
    expect(e.isRunning()).toBe(false);
  });
});

describe('LocalWhisperEngine quality gates', () => {
  it('skips a near-silent window entirely — no transcribe IPC, no caption', async () => {
    const stub = installStub({ autoText: () => 'should not be called' });
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(silentFrame(WINDOW_SAMPLES));
    await e.stopSession();
    // The silent window never reached native inference...
    expect(stub.transcribeCalls.length).toBe(0);
    // ...and produced no caption.
    expect(results).toEqual([]);
  });

  it('still transcribes a loud window and keeps the timeline cursor consistent across a silent gap', async () => {
    const stub = installStub();
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES));        // window 0 — speech (async)
    e.feedAudio(silentFrame(WINDOW_SAMPLES));  // window 1 — silent (skipped synchronously)
    e.feedAudio(frame(WINDOW_SAMPLES));        // window 2 — speech (async)
    expect(stub.transcribeCalls.length).toBe(2); // only the two loud windows
    stub.transcribeCalls[0].resolve('first');
    stub.transcribeCalls[1].resolve('third');
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['first', 'third']);
    // window 2 starts at 2× the window duration (the silent window
    // still advanced the timeline), so its startMs is strictly later.
    expect(results[1].startMs).toBeGreaterThan(results[0].startMs + 1);
  });

  it('drops a Whisper silence-hallucination ("Thank you for watching.") returned by a non-silent window', async () => {
    const stub = installStub();
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES)); // loud enough to transcribe
    stub.transcribeCalls[0].resolve('Thank you for watching.');
    await e.stopSession();
    expect(results).toEqual([]); // hallucination filtered out
  });

  it('keeps real text that merely contains a hallucination-like phrase', async () => {
    const stub = installStub();
    const e = new LocalWhisperEngine();
    const results: TranscriptResult[] = [];
    e.onTranscript((r) => results.push(r));
    await e.startSession({ sampleRate: SAMPLE_RATE });
    e.feedAudio(frame(WINDOW_SAMPLES));
    stub.transcribeCalls[0].resolve('Thank you for the proposal, let us revisit it next week.');
    await e.stopSession();
    expect(results.map(r => r.text)).toEqual(['Thank you for the proposal, let us revisit it next week.']);
  });
});
