import { describe, it, expect } from 'vitest';
import { XfyunEngine } from './xfyun-engine';

describe('XfyunEngine descriptor', () => {
  it('declares pcm-stream delivery mode', () => {
    const engine = new XfyunEngine();
    expect(engine.audioMode).toBe('pcm-stream');
  });

  it('declares supportsRealtime = true (streaming WebSocket protocol)', () => {
    expect(new XfyunEngine().supportsRealtime).toBe(true);
  });

  it('region is "china"', () => {
    expect(new XfyunEngine().region).toBe('china');
  });
});

describe('XfyunEngine.setApiKey + testConnection format checks', () => {
  it('rejects an empty key with a "missing credentials" message', async () => {
    const engine = new XfyunEngine();
    engine.setApiKey('');
    const r = await engine.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error || '').toMatch(/Missing credentials|凭据/);
  });

  it('rejects the one-part legacy form (just a single token)', async () => {
    const engine = new XfyunEngine();
    engine.setApiKey('just-one-token');
    const r = await engine.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error || '').toMatch(/Missing credentials|凭据/);
  });

  // We do not exercise live iFlytek auth from CI. The signature
  // module's tests (xfyun-signature.test.ts) pin the deterministic
  // signature format; the engine's own use of buildXfyunAuthUrl in
  // testConnection / startSession is exercised by the same code path.
});

describe('XfyunEngine.startSession (no real credentials)', () => {
  it('rejects when no credentials are configured', async () => {
    const engine = new XfyunEngine();
    await expect(
      engine.startSession({ sampleRate: 16000 })
    ).rejects.toThrow(/credentials|AppID/);
  });

  it('rejects the legacy one-part form', async () => {
    const engine = new XfyunEngine();
    engine.setApiKey('just-one-token');
    await expect(
      engine.startSession({ sampleRate: 16000 })
    ).rejects.toThrow(/credentials|AppID/);
  });
});

describe('XfyunEngine.feedAudio (pre-session)', () => {
  it('silently drops feed calls before startSession', () => {
    const engine = new XfyunEngine();
    expect(() => engine.feedAudio(new ArrayBuffer(8))).not.toThrow();
  });

  it('drops empty buffers without crashing', () => {
    const engine = new XfyunEngine();
    expect(() => engine.feedAudio(new ArrayBuffer(0))).not.toThrow();
  });
});

describe('XfyunEngine.isRunning', () => {
  it('is false until a session opens', () => {
    expect(new XfyunEngine().isRunning()).toBe(false);
  });
});
