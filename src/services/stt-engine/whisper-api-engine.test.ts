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
