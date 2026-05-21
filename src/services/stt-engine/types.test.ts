import { describe, it, expect } from 'vitest';
import {
  isSelectableSTTEngine,
  getDefaultSTTEngineForRegion,
  isSTTEngineVisibleForRegion,
  migrateSTTConfig,
  STT_ENGINE_INFO,
} from './types';

describe('isSelectableSTTEngine', () => {
  it('accepts stable engines (deepgram)', () => {
    expect(isSelectableSTTEngine('deepgram')).toBe(true);
  });

  it('rejects whisper_api — its feedAudio expects PCM Float32 but the production capture pipeline emits webm/opus, so it would produce garbage transcripts', () => {
    // Was 'stable' until a deeper review found the audio-format mismatch.
    // Demoted to 'planned' until the engine is reworked to accept webm
    // segments directly (OpenAI accepts webm).
    expect(isSelectableSTTEngine('whisper_api')).toBe(false);
  });

  it('rejects planned engines (xfyun) — its auth signing is still a placeholder so live sessions fail', () => {
    // Was 'beta' in earlier iterations on the assumption users could at
    // least attempt a connection. Codex review showed testConnection was
    // lying (format-only) and startSession would fail at the auth step, so
    // xfyun is non-selectable until HMAC-SHA256 signing lands.
    expect(isSelectableSTTEngine('xfyun')).toBe(false);
  });

  it('rejects planned engines (local_whisper) — silently falls back to demo otherwise', () => {
    expect(isSelectableSTTEngine('local_whisper')).toBe(false);
  });

  it('rejects engine IDs that were removed from the union (aliyun_speech)', () => {
    expect(isSelectableSTTEngine('aliyun_speech')).toBe(false);
  });

  it('rejects unknown engine IDs', () => {
    expect(isSelectableSTTEngine('made_up_engine')).toBe(false);
  });

  it('rejects undefined and null and empty', () => {
    expect(isSelectableSTTEngine(undefined)).toBe(false);
    expect(isSelectableSTTEngine(null)).toBe(false);
    expect(isSelectableSTTEngine('')).toBe(false);
  });
});

describe('getDefaultSTTEngineForRegion', () => {
  it('returns deepgram for global users (the only stable engine today; whisper_api is in the fallback chain but currently planned)', () => {
    expect(getDefaultSTTEngineForRegion('global')).toBe('deepgram');
  });

  it('returns deepgram for China users today — xfyun is planned, so the function skips it and falls back to a stable candidate', () => {
    // Codex review caught the previous behavior: returning 'xfyun' for
    // China handed users a default that was guaranteed to fail at runtime
    // because xfyun's auth signer is a placeholder. The function now walks
    // a candidate list rather than returning the region preference blindly.
    expect(getDefaultSTTEngineForRegion('china')).toBe('deepgram');
  });

  it('returns deepgram when region is null or undefined (safe fallback)', () => {
    expect(getDefaultSTTEngineForRegion(null)).toBe('deepgram');
    expect(getDefaultSTTEngineForRegion(undefined)).toBe('deepgram');
  });

  it('every returned default is itself selectable — this is the load-bearing invariant', () => {
    // If a default ever drifts to planned status this test will catch it.
    for (const region of ['china', 'global', null] as const) {
      const engine = getDefaultSTTEngineForRegion(region);
      expect(isSelectableSTTEngine(engine), `default for region=${region} (${engine}) must be selectable`).toBe(true);
    }
  });
});

describe('migrateSTTConfig', () => {
  it('passes through a stable engine selection unchanged', () => {
    const r = migrateSTTConfig('deepgram', { deepgram: 'sk-xxx' }, 'global');
    expect(r.engine).toBe('deepgram');
    expect(r.apiKeys).toEqual({ deepgram: 'sk-xxx' });
    expect(r.prunedKeys).toEqual([]);
    expect(r.engineChanged).toBe(false);
  });

  it('migrates a stored xfyun selection away — xfyun is currently planned (HMAC signing TODO), not selectable', () => {
    // China users with a stored xfyun selection now land on deepgram (the
    // first stable candidate) instead of being stuck on an engine whose
    // sessions cannot authenticate. They keep the xfyun key in case it
    // becomes selectable later, but get a working engine today.
    const r = migrateSTTConfig('xfyun', { xfyun: 'app:key:secret' }, 'china');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
    // The xfyun key is pruned because xfyun is no longer selectable today.
    // Once xfyun becomes selectable (HMAC signing implemented) the user
    // can re-enter their credentials.
    expect(r.apiKeys).toEqual({});
    expect(r.prunedKeys).toEqual(['xfyun']);
  });

  it('rewrites a stored local_whisper selection to the region default and reports the change', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'global');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites local_whisper to the China region fallback (deepgram today)', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'china');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites a removed engine ID (aliyun_speech) to the region fallback', () => {
    const r = migrateSTTConfig('aliyun_speech', {}, 'china');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
  });

  it('returns the region default for a missing / undefined stored engine', () => {
    expect(migrateSTTConfig(undefined, {}, 'global').engine).toBe('deepgram');
    expect(migrateSTTConfig(null, {}, 'china').engine).toBe('deepgram');
    expect(migrateSTTConfig('', {}, null).engine).toBe('deepgram');
  });

  it('prunes orphan API keys for removed engine IDs and lists them for deletion', () => {
    const r = migrateSTTConfig('deepgram', {
      deepgram: 'sk-xxx',
      aliyun_speech: 'leftover-secret',
    }, 'global');
    expect(r.apiKeys).toEqual({ deepgram: 'sk-xxx' });
    expect(r.prunedKeys).toEqual(['aliyun_speech']);
  });

  it('prunes API keys for planned engines so they cannot survive in encrypted storage', () => {
    const r = migrateSTTConfig('deepgram', {
      deepgram: 'sk-xxx',
      local_whisper: 'some-old-value',
    }, 'global');
    expect(r.apiKeys).toEqual({ deepgram: 'sk-xxx' });
    expect(r.prunedKeys).toEqual(['local_whisper']);
  });

  it('does not report empty orphan keys as pruned (no point persisting a no-op deletion)', () => {
    const r = migrateSTTConfig('deepgram', {
      deepgram: 'sk-xxx',
      aliyun_speech: '',          // never had a value
      local_whisper: '',          // never had a value
    }, 'global');
    expect(r.prunedKeys).toEqual([]);
  });

  it('handles a completely missing storedKeys object', () => {
    const r = migrateSTTConfig('deepgram', undefined, 'global');
    expect(r.apiKeys).toEqual({});
    expect(r.prunedKeys).toEqual([]);
  });

  it('handles the worst legacy case (planned engine + orphan keys + no region)', () => {
    const r = migrateSTTConfig('local_whisper', {
      aliyun_speech: 'old1',
      local_whisper: 'old2',
      xfyun: 'old3',
      whisper_api: 'old4',       // whisper_api is also planned today
      deepgram: 'sk-real',       // the only selectable engine
    }, null);
    expect(r.engine).toBe('deepgram');               // region null → global default
    expect(r.engineChanged).toBe(true);
    expect(r.apiKeys).toEqual({ deepgram: 'sk-real' }); // only selectable engine retained
    expect(r.prunedKeys.sort()).toEqual(['aliyun_speech', 'local_whisper', 'whisper_api', 'xfyun']);
  });
});

describe('STT_ENGINE_INFO invariants', () => {
  it('every engine declares a status', () => {
    for (const e of STT_ENGINE_INFO) {
      expect(['stable', 'beta', 'planned']).toContain(e.status);
    }
  });

  it('every non-stable engine carries a statusNote so the UI has something to surface', () => {
    for (const e of STT_ENGINE_INFO) {
      if (e.status !== 'stable') {
        expect(e.statusNote, `${e.id} (${e.status}) is missing statusNote`).toBeTruthy();
      }
    }
  });

  it('global users always see at least one selectable engine in the picker', () => {
    const globalSelectable = STT_ENGINE_INFO.filter(
      e => isSTTEngineVisibleForRegion(e, 'global') && isSelectableSTTEngine(e.id)
    );
    expect(globalSelectable.length).toBeGreaterThan(0);
  });

  it('China users always see at least one selectable engine in the picker (global engines act as fallback when no China-native engine is selectable)', () => {
    const chinaSelectable = STT_ENGINE_INFO.filter(
      e => isSTTEngineVisibleForRegion(e, 'china') && isSelectableSTTEngine(e.id)
    );
    expect(chinaSelectable.length).toBeGreaterThan(0);
  });
});

describe('isSTTEngineVisibleForRegion', () => {
  // Compact fixture for picker visibility — the asymmetry (China users see
  // global engines, global users do NOT see China engines) is intentional;
  // see the docstring on the function.
  it('local engines always show', () => {
    expect(isSTTEngineVisibleForRegion({ region: 'local' }, 'global')).toBe(true);
    expect(isSTTEngineVisibleForRegion({ region: 'local' }, 'china')).toBe(true);
    expect(isSTTEngineVisibleForRegion({ region: 'local' }, null)).toBe(true);
  });

  it('global engines always show', () => {
    expect(isSTTEngineVisibleForRegion({ region: 'global' }, 'global')).toBe(true);
    expect(isSTTEngineVisibleForRegion({ region: 'global' }, 'china')).toBe(true);
    expect(isSTTEngineVisibleForRegion({ region: 'global' }, null)).toBe(true);
  });

  it('China engines show ONLY for China users', () => {
    expect(isSTTEngineVisibleForRegion({ region: 'china' }, 'china')).toBe(true);
    expect(isSTTEngineVisibleForRegion({ region: 'china' }, 'global')).toBe(false);
    expect(isSTTEngineVisibleForRegion({ region: 'china' }, null)).toBe(false);
  });
});
