import { describe, it, expect } from 'vitest';
import { sttRegistry } from './engine-registry';

describe('sttRegistry.getConfiguredEngine fallback', () => {
  it('returns the mock engine when no engine has a usable key', async () => {
    const result = await sttRegistry.getConfiguredEngine('deepgram', {});
    expect(result.isMock).toBe(true);
  });

  it('honors the preferred engine when its key is present', async () => {
    const result = await sttRegistry.getConfiguredEngine('deepgram', { deepgram: 'sk-xxx' });
    expect(result.isMock).toBe(false);
    expect(result.engine.id).toBe('deepgram');
  });

  it('does not let a spurious local_whisper key bypass the availability check (no native module in node test → mock)', async () => {
    // local_whisper is keyless: a stored "key" must NOT short-circuit
    // selection. The engine is availability-tested via testConnection,
    // which fails in the node test env (no window.electronAPI / native
    // module), so we correctly fall back to mock rather than returning a
    // non-functional engine.
    const result = await sttRegistry.getConfiguredEngine('local_whisper', {
      local_whisper: 'pretend-this-was-set-somehow',
    });
    expect(result.isMock).toBe(true);
  });

  it('falls through preferred=deepgram (no key) to whisper_api when only whisper_api has a key', async () => {
    // Whisper API is selectable again now that capture drives it in
    // segment mode. With no Deepgram key but a Whisper key configured,
    // the fallback loop should land on whisper_api as non-mock.
    const result = await sttRegistry.getConfiguredEngine('deepgram', {
      local_whisper: 'should-be-ignored',
      whisper_api: 'sk-valid',
      xfyun: 'app:key:secret',
    });
    expect(result.isMock).toBe(false);
    expect(result.engine.id).toBe('whisper_api');
  });

  it('does not surface keyless local_whisper from the fallback loop on a spurious key (falls back to mock)', async () => {
    // preferred=deepgram has no key; the only stored "key" is for the
    // keyless local_whisper. The fallback loop skips keyless engines
    // (they are only chosen as the explicit preferred engine, where
    // they get availability-tested), so this lands on mock.
    const result = await sttRegistry.getConfiguredEngine('deepgram', {
      local_whisper: 'should-be-ignored',
    });
    expect(result.isMock).toBe(true);
  });

  it('uses xfyun when xfyun is the preferred engine and has a key', async () => {
    const result = await sttRegistry.getConfiguredEngine('xfyun', {
      xfyun: 'app:key:secret',
    });
    expect(result.isMock).toBe(false);
    expect(result.engine.id).toBe('xfyun');
  });

  it('skips orphan keys for removed engine IDs (aliyun_speech)', async () => {
    // Same guard, applied to a key for an engine ID that has been removed
    // from the union entirely. Casting through `unknown` is just to placate
    // the type checker — the runtime case is "the encrypted store still
    // has an old entry".
    const result = await sttRegistry.getConfiguredEngine('deepgram', {
      ['aliyun_speech' as never]: 'stale-secret',
    } as Record<string, string>);
    expect(result.isMock).toBe(true);
  });
});
