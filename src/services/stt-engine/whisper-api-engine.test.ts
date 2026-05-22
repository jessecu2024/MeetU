import { describe, it, expect } from 'vitest';
import { WhisperAPIEngine, looksLikeHallucination } from './whisper-api-engine';

describe('WhisperAPIEngine', () => {
  describe('engine descriptor', () => {
    it('declares segment delivery mode', () => {
      const engine = new WhisperAPIEngine();
      expect(engine.audioMode).toBe('segment');
      expect(engine.segmentDurationMs).toBe(5000);
    });

    it('reports non-streaming so callers know about the segment latency tradeoff', () => {
      const engine = new WhisperAPIEngine();
      expect(engine.supportsRealtime).toBe(false);
    });
  });

  describe('startSession', () => {
    it('rejects when no API key has been configured', async () => {
      const engine = new WhisperAPIEngine();
      await expect(
        engine.startSession({ sampleRate: 16000 })
      ).rejects.toThrow(/Whisper API Key not configured/);
    });

    it('starts cleanly with an API key (no auto-throw; the segment recorder is driven by capture)', async () => {
      const engine = new WhisperAPIEngine();
      engine.setApiKey('sk-test');
      await expect(
        engine.startSession({ sampleRate: 16000 })
      ).resolves.toBeUndefined();
      expect(engine.isRunning()).toBe(true);
      await engine.stopSession();
      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('transcript ordering under parallel fetch', () => {
    // The engine fires fetches in parallel for back-to-back segments.
    // OpenAI's response order is not guaranteed: a fast segment 2 can
    // return before a slow segment 1. The engine must buffer early
    // arrivals and emit transcripts in startMs order so the renderer
    // and summarizer never see out-of-sequence content.
    //
    // Ordering machinery is private; we reach it via Reflect-style
    // bracket access rather than reshape the public surface for tests.
    // The escape-hatch is contained to this block.
    type Internals = {
      deliverSegmentResult: (r: import('./types').TranscriptResult) => void;
      markSegmentEmpty: (startMs: number) => void;
    };

    function asInternals(e: WhisperAPIEngine): Internals {
      return e as unknown as Internals;
    }

    function mkResult(startMs: number, text: string): import('./types').TranscriptResult {
      return {
        id: `t${startMs}`,
        text,
        isFinal: true,
        startMs,
        endMs: startMs + 5000,
        confidence: 0.9,
      };
    }

    it('emits in startMs order even when results arrive out of order', async () => {
      const engine = new WhisperAPIEngine();
      const internals = asInternals(engine);
      engine.setApiKey('sk-test');
      await engine.startSession({ sampleRate: 16000 });
      const got: string[] = [];
      engine.onTranscript((r) => got.push(`${r.startMs}:${r.text}`));

      // Simulate: segment at 5000ms came back first, then 0ms, then 10000ms.
      internals.deliverSegmentResult(mkResult(5000, 'second'));
      expect(got).toEqual([]); // nothing emitted yet — waiting for 0
      internals.deliverSegmentResult(mkResult(0, 'first'));
      // Both flush in order now that the cursor caught up.
      expect(got).toEqual(['0:first', '5000:second']);
      internals.deliverSegmentResult(mkResult(10000, 'third'));
      expect(got).toEqual(['0:first', '5000:second', '10000:third']);
      await engine.stopSession();
    });

    it('a failed segment (markSegmentEmpty) does not block later segments', async () => {
      const engine = new WhisperAPIEngine();
      const internals = asInternals(engine);
      engine.setApiKey('sk-test');
      await engine.startSession({ sampleRate: 16000 });
      const got: string[] = [];
      engine.onTranscript((r) => got.push(`${r.startMs}:${r.text}`));

      // Segment at 0ms fails; segments at 5000ms and 10000ms succeed.
      // Without the cursor advancing past the failed slot, both later
      // segments would be buffered forever waiting for 0ms.
      internals.deliverSegmentResult(mkResult(5000, 'second'));
      internals.deliverSegmentResult(mkResult(10000, 'third'));
      expect(got).toEqual([]);
      internals.markSegmentEmpty(0);
      expect(got).toEqual(['5000:second', '10000:third']);
      await engine.stopSession();
    });

    it('out-of-order failures + successes drain correctly', async () => {
      const engine = new WhisperAPIEngine();
      const internals = asInternals(engine);
      engine.setApiKey('sk-test');
      await engine.startSession({ sampleRate: 16000 });
      const got: string[] = [];
      engine.onTranscript((r) => got.push(`${r.startMs}:${r.text}`));

      internals.deliverSegmentResult(mkResult(10000, 'C'));
      internals.markSegmentEmpty(5000);
      expect(got).toEqual([]); // still waiting for 0
      internals.deliverSegmentResult(mkResult(0, 'A'));
      expect(got).toEqual(['0:A', '10000:C']);
      await engine.stopSession();
    });
  });

  describe('feedAudio', () => {
    it('silently drops feedAudio calls before startSession', () => {
      const engine = new WhisperAPIEngine();
      // No-throw: the engine ignores audio when not running.
      expect(() => engine.feedAudio(new ArrayBuffer(8))).not.toThrow();
    });

    it('silently drops feedAudio after stopSession', async () => {
      const engine = new WhisperAPIEngine();
      engine.setApiKey('sk-test');
      await engine.startSession({ sampleRate: 16000 });
      await engine.stopSession();
      expect(() => engine.feedAudio(new ArrayBuffer(8))).not.toThrow();
    });

    it('drops empty buffers without making a request', () => {
      const engine = new WhisperAPIEngine();
      engine.setApiKey('sk-test');
      // Empty buffer should be a no-op, not a 0-byte POST.
      expect(() => engine.feedAudio(new ArrayBuffer(0))).not.toThrow();
    });
  });
});

describe('looksLikeHallucination', () => {
  it('flags the classic English "thank you" silence hallucinations', () => {
    expect(looksLikeHallucination('Thank you.')).toBe(true);
    expect(looksLikeHallucination('Thanks for watching!')).toBe(true);
    expect(looksLikeHallucination('Thanks for watching.')).toBe(true);
    expect(looksLikeHallucination('THANK YOU.')).toBe(true); // case-insensitive
  });

  it('flags the "thank you for watching" variants Whisper actually emits', () => {
    // These came up in field traces; the test exists so we don't let
    // them slip back in if someone shuffles the filter.
    expect(looksLikeHallucination('Thank you for watching.')).toBe(true);
    expect(looksLikeHallucination('Thank you for watching!')).toBe(true);
    expect(looksLikeHallucination('Thank you so much for watching.')).toBe(true);
    expect(looksLikeHallucination('Thanks for watching everyone!')).toBe(true);
    expect(looksLikeHallucination('Thanks for watching the video.')).toBe(true);
    expect(looksLikeHallucination('Thank you very much!')).toBe(true);
  });

  it('flags punctuation-only / "..." patterns Whisper emits for silence', () => {
    expect(looksLikeHallucination('...')).toBe(true);
    expect(looksLikeHallucination('. .')).toBe(true);
    expect(looksLikeHallucination('。')).toBe(true);
  });

  it('flags Chinese subtitle hallucinations', () => {
    expect(looksLikeHallucination('字幕组提供')).toBe(true);
    expect(looksLikeHallucination('字幕 by example')).toBe(true);
    expect(looksLikeHallucination('请订阅本频道')).toBe(true);
    expect(looksLikeHallucination('请关注下集')).toBe(true);
  });

  it('does NOT flag substantive transcripts that happen to contain "thank you"', () => {
    // A real meeting utterance ending in thank-you. Critical to keep.
    expect(looksLikeHallucination('That works, thank you, see you tomorrow.')).toBe(false);
    expect(looksLikeHallucination('Thank you for the proposal, but we should revisit the timeline.')).toBe(false);
  });

  it('does NOT flag substantive Chinese transcripts', () => {
    expect(looksLikeHallucination('我们下次会议确认这件事')).toBe(false);
    expect(looksLikeHallucination('谢谢大家，今天就到这里')).toBe(false);
  });

  it('handles surrounding whitespace', () => {
    expect(looksLikeHallucination('  Thank you.  ')).toBe(true);
    expect(looksLikeHallucination('\n...\n')).toBe(true);
  });
});
