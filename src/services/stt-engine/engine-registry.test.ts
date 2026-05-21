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

  it('skips planned engines in the fallback loop and picks the next selectable one with a key', async () => {
    // Preferred engine has no key; planned engine has a (stale) key; a real
    // engine also has a key. The loop must skip the planned entry and land
    // on the real one.
    const result = await sttRegistry.getConfiguredEngine('deepgram', {
      local_whisper: 'should-be-ignored',
      whisper_api: 'sk-real',
    });
    expect(result.isMock).toBe(false);
    expect(result.engine.id).toBe('whisper_api');
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
