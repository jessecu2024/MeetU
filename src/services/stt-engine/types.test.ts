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

  it('accepts whisper_api now that capture drives it in segment mode (one complete webm file per 5s window)', () => {
    // Was demoted to 'planned' for a while: feedAudio expected PCM Float32
    // but production capture emits webm/opus. After reworking the engine
    // to receive complete webm segments from a parallel MediaRecorder in
    // capture.ts, whisper_api is back to stable.
    expect(isSelectableSTTEngine('whisper_api')).toBe(true);
  });

  it('accepts xfyun now that HMAC-SHA256 signing + PCM stream mode are implemented', () => {
    // Was 'planned' for a long while because the WebSocket auth signer
    // emitted `signature="placeholder"` and audio came in as webm/opus
    // (engine expected PCM). Both are real now: signature is built
    // via WebCrypto in xfyun-signature.ts, and capture has a dedicated
    // 'pcm-stream' audioMode driving an AudioWorklet → 16-kHz resampler.
    expect(isSelectableSTTEngine('xfyun')).toBe(true);
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
  it('returns deepgram for global users (first stable candidate; whisper_api is also stable now but deepgram is listed first because of its streaming latency advantage)', () => {
    expect(getDefaultSTTEngineForRegion('global')).toBe('deepgram');
  });

  it('returns xfyun for China users now that the engine is stable', () => {
    // Was 'deepgram' for a while because xfyun was planned; now that
    // its auth signing and PCM pipeline are both shipping, China users
    // land on the region-native engine again.
    expect(getDefaultSTTEngineForRegion('china')).toBe('xfyun');
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

  it('keeps a stored xfyun selection now that the engine is stable', () => {
    // For a long while xfyun was 'planned' and the migration pruned it
    // from both the active selection and the key map. Now that the
    // engine ships, China users with a stored xfyun selection should
    // simply keep it (and their AppID:APIKey:APISecret credential).
    const r = migrateSTTConfig('xfyun', { xfyun: 'app:key:secret' }, 'china');
    expect(r.engine).toBe('xfyun');
    expect(r.engineChanged).toBe(false);
    expect(r.apiKeys).toEqual({ xfyun: 'app:key:secret' });
    expect(r.prunedKeys).toEqual([]);
  });

  it('rewrites a stored local_whisper selection to the region default and reports the change', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'global');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites local_whisper to the China region default (xfyun today)', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'china');
    expect(r.engine).toBe('xfyun');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites a removed engine ID (aliyun_speech) to the region fallback (xfyun for China)', () => {
    const r = migrateSTTConfig('aliyun_speech', {}, 'china');
    expect(r.engine).toBe('xfyun');
    expect(r.engineChanged).toBe(true);
  });

  it('returns the region default for a missing / undefined stored engine', () => {
    expect(migrateSTTConfig(undefined, {}, 'global').engine).toBe('deepgram');
    expect(migrateSTTConfig(null, {}, 'china').engine).toBe('xfyun');
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
      xfyun: 'app:key:secret',          // xfyun is stable now, key kept
      whisper_api: 'sk-also-valid',     // whisper_api stable, key kept
      deepgram: 'sk-real',              // deepgram stable, key kept
    }, null);
    expect(r.engine).toBe('deepgram');               // region null → global default
    expect(r.engineChanged).toBe(true);
    // Three stable-engine keys retained; only truly-unusable engine
    // keys (aliyun_speech removed, local_whisper still planned) are
    // pruned from encrypted storage.
    expect(r.apiKeys).toEqual({
      deepgram: 'sk-real',
      whisper_api: 'sk-also-valid',
      xfyun: 'app:key:secret',
    });
    expect(r.prunedKeys.sort()).toEqual(['aliyun_speech', 'local_whisper']);
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
