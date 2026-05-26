import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { useSettingsStore } from './settings-store';

// The store is renderer-process code that calls `window.electronAPI` to
// persist. In the node-environment Vitest run there's no `window` global,
// so we stub a minimal one for the duration of these tests. The `?.` in
// the store's persist() ensures the missing electronAPI is a no-op, which
// is exactly what we want for unit-testing the in-memory state transitions.
beforeAll(() => {
  vi.stubGlobal('window', {});
});

describe('useSettingsStore.setUserRegion', () => {
  beforeEach(() => {
    // Reset to a known initial state for each test.
    useSettingsStore.setState({
      userRegion: null,
      sttEngine: 'deepgram',
      aiConfig: {
        defaultProvider: 'claude',
        functionOverrides: {},
        apiKeys: {},
        selectedModels: {},
      },
    });
  });

  it('picks xfyun for China users now that the engine is stable', () => {
    // For a long while this had to fall back to deepgram because xfyun
    // was planned. Now that xfyun ships with real HMAC + PCM streaming,
    // China users land on the region-native engine.
    useSettingsStore.getState().setUserRegion('china');
    const { sttEngine } = useSettingsStore.getState();
    expect(sttEngine).toBe('xfyun');
  });

  it('picks deepgram for global users', () => {
    useSettingsStore.getState().setUserRegion('global');
    expect(useSettingsStore.getState().sttEngine).toBe('deepgram');
  });

  it('also updates the AI default provider per region', () => {
    useSettingsStore.getState().setUserRegion('china');
    expect(useSettingsStore.getState().aiConfig.defaultProvider).toBe('deepseek');
    useSettingsStore.getState().setUserRegion('global');
    expect(useSettingsStore.getState().aiConfig.defaultProvider).toBe('claude');
  });
});

describe('useSettingsStore.setSTTApiKey', () => {
  beforeEach(() => {
    useSettingsStore.setState({ sttApiKeys: {} });
  });

  it('accepts a key for a selectable engine (deepgram)', () => {
    useSettingsStore.getState().setSTTApiKey('deepgram', 'sk-xxx');
    expect(useSettingsStore.getState().sttApiKeys.deepgram).toBe('sk-xxx');
  });

  it('refuses to persist a key for a non-selectable engine id (removed aliyun_speech)', () => {
    // Regression guard: even if a UI/feature-flag bug lets the user reach
    // the "save key" code path for an engine that isn't selectable, the
    // store must drop the write so no orphan secret lands in encrypted
    // storage. No engine is 'planned' today, so we exercise the guard
    // with a removed-from-union id (cast through STTEngineId).
    useSettingsStore.getState().setSTTApiKey('aliyun_speech' as never, 'pretend-secret');
    expect((useSettingsStore.getState().sttApiKeys as Record<string, string>).aliyun_speech).toBeUndefined();
  });

  it('accepts a key for xfyun now that it is selectable', () => {
    useSettingsStore.getState().setSTTApiKey('xfyun', 'app:key:secret');
    expect(useSettingsStore.getState().sttApiKeys.xfyun).toBe('app:key:secret');
  });

  it('refuses to persist a key for a keyless engine (local_whisper) even though it is selectable', () => {
    // local_whisper is selectable (beta) but requiresApiKey:false. A
    // stray write must not land a dead secret in encrypted storage —
    // the write-path guard enforces the same invariant migrate applies
    // on load.
    useSettingsStore.getState().setSTTApiKey('local_whisper', 'pretend-secret');
    expect(useSettingsStore.getState().sttApiKeys.local_whisper).toBeUndefined();
  });
});

describe('useSettingsStore.setSTTEngine', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      userRegion: 'global',
      sttEngine: 'deepgram',
    });
  });

  it('accepts a selectable engine (deepgram)', () => {
    useSettingsStore.setState({ sttEngine: 'whisper_api' });
    useSettingsStore.getState().setSTTEngine('deepgram');
    expect(useSettingsStore.getState().sttEngine).toBe('deepgram');
  });

  it('accepts the segment-mode engine (whisper_api) now that capture supports it', () => {
    useSettingsStore.setState({ sttEngine: 'deepgram' });
    useSettingsStore.getState().setSTTEngine('whisper_api');
    expect(useSettingsStore.getState().sttEngine).toBe('whisper_api');
  });

  it('accepts local_whisper now that it is selectable (beta)', () => {
    // Was rejected + rewritten to the region default while planned.
    // Now offline Whisper ships, so the selection sticks.
    useSettingsStore.getState().setSTTEngine('local_whisper');
    expect(useSettingsStore.getState().sttEngine).toBe('local_whisper');
  });

  it('accepts xfyun (now stable) without rewriting', () => {
    useSettingsStore.getState().setSTTEngine('xfyun');
    expect(useSettingsStore.getState().sttEngine).toBe('xfyun');
  });

  it('falls back to the region default when a non-selectable id is forced through (removed aliyun_speech)', () => {
    // The store-level guard normalizes a non-selectable id to a
    // selectable one. No engine is 'planned' now, so we exercise it
    // with a removed-from-union id.
    useSettingsStore.setState({ userRegion: 'china' });
    useSettingsStore.getState().setSTTEngine('aliyun_speech' as never);
    expect(useSettingsStore.getState().sttEngine).toBe('xfyun');
  });
});
