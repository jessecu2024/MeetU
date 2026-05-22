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

  it('picks a selectable STT engine for China users instead of hard-coding xfyun', () => {
    // Regression guard: previously this set sttEngine to 'xfyun' which is
    // currently planned (HMAC signer is a placeholder). The store now
    // delegates to getDefaultSTTEngineForRegion, which walks a fallback
    // chain and only returns selectable engines.
    useSettingsStore.getState().setUserRegion('china');
    const { sttEngine } = useSettingsStore.getState();
    expect(sttEngine).toBe('deepgram');
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

  it('refuses to persist a key for a planned engine (local_whisper)', () => {
    // Regression guard: even if a UI/feature-flag bug lets the user reach
    // the "save key" code path for a planned engine, the store must drop
    // the write so that no secret lands in encrypted storage that the next
    // migration would have to clean up.
    useSettingsStore.getState().setSTTApiKey('local_whisper', 'pretend-secret');
    expect(useSettingsStore.getState().sttApiKeys.local_whisper).toBeUndefined();
  });

  it('refuses to persist a key for a planned engine (xfyun)', () => {
    useSettingsStore.getState().setSTTApiKey('xfyun', 'app:key:secret');
    expect(useSettingsStore.getState().sttApiKeys.xfyun).toBeUndefined();
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

  it('refuses a planned engine (local_whisper) and falls back to the region default', () => {
    // Store-level guard: even if a UI bug lets a planned engine click
    // through, the store normalizes to a selectable one. Without this,
    // a stray setSTTEngine('local_whisper') call would persist a broken
    // selection that survives until next migration.
    useSettingsStore.getState().setSTTEngine('local_whisper');
    expect(useSettingsStore.getState().sttEngine).toBe('deepgram');
  });

  it('refuses a planned engine (xfyun) and falls back to the region default', () => {
    useSettingsStore.getState().setSTTEngine('xfyun');
    expect(useSettingsStore.getState().sttEngine).toBe('deepgram');
  });

  it('uses the China region default when a planned engine is rejected for a China user', () => {
    useSettingsStore.setState({ userRegion: 'china' });
    // China region also walks the fallback list — today this still lands
    // on deepgram because xfyun is planned.
    useSettingsStore.getState().setSTTEngine('local_whisper');
    expect(useSettingsStore.getState().sttEngine).toBe('deepgram');
  });
});
