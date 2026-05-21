import { describe, it, expect } from 'vitest';
import {
  isSelectableSTTEngine,
  getDefaultSTTEngineForRegion,
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
