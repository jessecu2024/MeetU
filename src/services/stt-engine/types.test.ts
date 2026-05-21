import { describe, it, expect } from 'vitest';
import {
  isSelectableSTTEngine,
  getDefaultSTTEngineForRegion,
  migrateSTTConfig,
  STT_ENGINE_INFO,
} from './types';

describe('isSelectableSTTEngine', () => {
  it('accepts stable engines (deepgram)', () => {
    expect(isSelectableSTTEngine('deepgram')).toBe(true);
  });

  it('accepts stable engines (whisper_api)', () => {
    expect(isSelectableSTTEngine('whisper_api')).toBe(true);
  });

  it('accepts beta engines (xfyun) — they are real but incomplete, user can still try', () => {
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
  it('returns xfyun for China users', () => {
    expect(getDefaultSTTEngineForRegion('china')).toBe('xfyun');
  });

  it('returns deepgram for global users', () => {
    expect(getDefaultSTTEngineForRegion('global')).toBe('deepgram');
  });

  it('returns deepgram when region is null or undefined (safe fallback)', () => {
    expect(getDefaultSTTEngineForRegion(null)).toBe('deepgram');
    expect(getDefaultSTTEngineForRegion(undefined)).toBe('deepgram');
  });

  it('every returned default is itself selectable', () => {
    // If a default ever drifts to planned status this test will catch it.
    for (const region of ['china', 'global', null] as const) {
      const engine = getDefaultSTTEngineForRegion(region);
      expect(isSelectableSTTEngine(engine)).toBe(true);
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

  it('passes through a beta engine selection (xfyun is still selectable)', () => {
    const r = migrateSTTConfig('xfyun', { xfyun: 'app:key:secret' }, 'china');
    expect(r.engine).toBe('xfyun');
    expect(r.engineChanged).toBe(false);
    expect(r.apiKeys).toEqual({ xfyun: 'app:key:secret' });
  });

  it('rewrites a stored local_whisper selection to the region default and reports the change', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'global');
    expect(r.engine).toBe('deepgram');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites local_whisper to xfyun for China users', () => {
    const r = migrateSTTConfig('local_whisper', {}, 'china');
    expect(r.engine).toBe('xfyun');
    expect(r.engineChanged).toBe(true);
  });

  it('rewrites a removed engine ID (aliyun_speech) to the region default', () => {
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
      whisper_api: 'sk-real',
    }, null);
    expect(r.engine).toBe('deepgram');               // region null → global default
    expect(r.engineChanged).toBe(true);
    expect(r.apiKeys).toEqual({ whisper_api: 'sk-real' }); // only selectable engine retained
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

  it('at least one engine is selectable for global users', () => {
    const globalSelectable = STT_ENGINE_INFO.filter(
      e => (e.region === 'global' || e.region === 'local') && isSelectableSTTEngine(e.id)
    );
    expect(globalSelectable.length).toBeGreaterThan(0);
  });

  it('at least one engine is selectable for China users', () => {
    const chinaSelectable = STT_ENGINE_INFO.filter(
      e => (e.region === 'china' || e.region === 'local') && isSelectableSTTEngine(e.id)
    );
    expect(chinaSelectable.length).toBeGreaterThan(0);
  });
});
