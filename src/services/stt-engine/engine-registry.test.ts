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

  it('falls through from local_whisper (stub) to mock when no other engine has a key', async () => {
    // Regression guard: previously the fallback loop could return the Local
    // Whisper stub as `isMock: false` if `apiKeys.local_whisper` had any
    // truthy value at all. Now it must skip planned engines entirely.
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

  it('skips planned engines in the fallback loop and falls back to mock when no selectable engine has a key', async () => {
    const result = await sttRegistry.getConfiguredEngine('deepgram', {
      local_whisper: 'should-be-ignored',
      xfyun: 'app:key:secret',
    });
    expect(result.isMock).toBe(true);
  });

  it('uses deepgram when it has a key, regardless of other planned keys present', async () => {
    const result = await sttRegistry.getConfiguredEngine('xfyun', {
      deepgram: 'sk-real',
      xfyun: 'planned-no-effect',
    });
    expect(result.isMock).toBe(false);
    expect(result.engine.id).toBe('deepgram');
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
