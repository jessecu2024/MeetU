// ============================================================
// Settings Store (Zustand)
// Manages user settings with electron-store persistence
// API Keys are encrypted via electron's safeStorage
// ============================================================

import { create } from 'zustand';
import type { AIProviderId, AIFunction, UserAIConfig } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';
import { migrateSTTConfig, getDefaultSTTEngineForRegion, isSelectableSTTEngine, STT_ENGINE_INFO } from '../services/stt-engine/types';

// Type for electron API (injected via preload)
declare global {
  interface Window {
    electronAPI?: {
      audio: {
        startRecording: () => Promise<string>;
        stopRecording: () => Promise<string>;
        appendChunk: (data: ArrayBuffer) => Promise<void>;
        isRecording: () => Promise<boolean>;
        getRecordingsPath: () => Promise<string>;
        getDevices: () => Promise<unknown[]>;
        probeSystemAudio: () => Promise<{
          supported: boolean;
          mode?: 'electron-loopback' | 'macos-native';
          perAppCapture?: boolean;
          reason?: string;
          permission?: string;
          version?: string;
        }>;
        onChunk: (cb: (chunk: ArrayBuffer) => void) => void;
        onLevel: (cb: (level: number) => void) => void;
        macos: {
          listApps: () => Promise<{
            ok: boolean;
            apps: Array<{ pid: number; name: string; bundleId: string }>;
            error?: string;
          }>;
          start: (opts: { pid?: number }) => Promise<{ ok: boolean; error?: string }>;
          stop: () => Promise<{ ok: boolean; error?: string }>;
          onPcmFrame: (cb: (buf: ArrayBuffer) => void) => () => void;
          onError: (cb: (err: { message: string; code: number }) => void) => () => void;
        };
        localWhisper: {
          probe: () => Promise<{
            available: boolean;
            reason?: string;
            models: Array<{ name: string; present: boolean; url: string; sizeBytes?: number }>;
            hasAnyModel: boolean;
          }>;
          downloadModel: (name: string) => Promise<{ ok: boolean; error?: string }>;
          start: (opts: { model: string }) => Promise<{ ok: boolean; error?: string }>;
          transcribe: (pcm: ArrayBuffer, opts: { language?: string }) => Promise<{ ok: boolean; text?: string; error?: string }>;
          stop: () => Promise<{ ok: boolean }>;
          onDownloadProgress: (cb: (p: { model: string; receivedBytes: number; totalBytes: number }) => void) => () => void;
        };
      };
      settings: {
        get: (key: string) => Promise<unknown>;
        set: (key: string, value: unknown) => Promise<void>;
      };
      db: {
        query: (sql: string, params?: unknown[]) => Promise<unknown>;
      };
      file: {
        export: (format: string, content: string) => Promise<unknown>;
      };
      window: {
        minimize: () => void;
        close: () => void;
        toggleTop: () => void;
        setOpacity: (v: number) => void;
      };
      onShortcut: {
        toggleRecording: (cb: () => void) => void;
      };
      platform: string;
    };
  }
}

interface UserProfile {
  name: string;
  nameEn: string;
  aliases: string[];
  role: string;
  preferredLanguage: 'zh' | 'en';
}

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  windowOpacity: number;
  windowAlwaysOnTop: boolean;
  fontSize: 'small' | 'medium' | 'large';
  autoStartRecording: boolean;
  summaryIntervalMinutes: number;
  audioRetentionDays: number;
  micDeviceId: string;
  micDeviceLabel: string;
  sysAudioDeviceId: string;
  sysAudioDeviceLabel: string;
  // macOS native per-app capture target. 0 (or undefined) means the
  // whole-system mix; a positive pid captures only that application via
  // ScreenCaptureKit's SCContentFilter(includingApplications:). Only
  // honored when the system-audio backend resolves to 'macos-native'.
  sysAudioMacAppPid: number;
  sysAudioMacAppLabel: string;
  outputDeviceId: string;
  outputDeviceLabel: string;
  // Local Whisper (offline) — which ggml model the engine loads. Must
  // be one downloaded via the Settings model manager; defaults to
  // 'base' but the engine errors clearly if the chosen model isn't on
  // disk yet.
  localWhisperModel: string;
}

/** Connection status for each AI provider */
export type ConnectionStatus = 'connected' | 'untested' | 'failed' | 'unconfigured';

/** Test result that persists across modal open/close (in-memory only) */
export interface TestResult {
  status: 'idle' | 'testing' | 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

interface SettingsState {
  // ── Legal consent ──
  legalAccepted: boolean;

  // ── Initialization ──
  isFirstLaunch: boolean;
  onboardingStep: number;
  settingsModalOpen: boolean;
  settingsModalTab: 'ai' | 'stt' | 'profile' | 'app' | null;
  settingsLoaded: boolean;

  // ── User profile ──
  userProfile: UserProfile;

  // ── AI configuration ──
  userRegion: 'global' | 'china' | null;
  aiConfig: UserAIConfig;
  connectionStatuses: Partial<Record<AIProviderId, ConnectionStatus>>;

  // ── STT configuration ──
  sttEngine: STTEngineId;
  sttApiKeys: Partial<Record<STTEngineId, string>>;

  // ── App settings ──
  appSettings: AppSettings;

  // ── Glossary ──
  customTerms: Array<{ source: string; target: string }>;

  // ── Test results (in-memory only, persist across modal open/close) ──
  aiTestResults: Partial<Record<AIProviderId, TestResult>>;
  sttTestResult: TestResult;

  // ── Actions ──
  loadFromStore: () => Promise<void>;
  acceptLegal: () => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  setUserRegion: (region: 'global' | 'china') => void;
  setDefaultProvider: (id: AIProviderId) => void;
  setApiKey: (provider: AIProviderId, key: string) => void;
  setConnectionStatus: (provider: AIProviderId, status: ConnectionStatus) => void;
  getConnectionStatus: (provider: AIProviderId) => ConnectionStatus;
  setFunctionOverride: (fn: AIFunction, provider: AIProviderId) => void;
  setSelectedModel: (provider: AIProviderId, modelId: string) => void;
  setSTTEngine: (id: STTEngineId) => void;
  setSTTApiKey: (engine: STTEngineId, key: string) => void;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  addCustomTerm: (source: string, target: string) => void;
  removeCustomTerm: (index: number) => void;
  setAiTestResult: (provider: AIProviderId, result: TestResult) => void;
  setSttTestResult: (result: TestResult) => void;
  openSettingsModal: (tab?: 'ai' | 'stt' | 'profile' | 'app' | unknown) => void;
  closeSettingsModal: () => void;
}

/** Helper to persist a setting to electron-store */
function persist(key: string, value: unknown) {
  window.electronAPI?.settings.set(key, value).catch(() => {});
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // ── Legal consent ──
  legalAccepted: false,

  // ── Initialization ──
  isFirstLaunch: true,
  onboardingStep: 0,
  settingsModalOpen: false,
  settingsModalTab: null,
  settingsLoaded: false,

  // ── User profile ──
  userProfile: {
    name: '',
    nameEn: '',
    aliases: [],
    role: '',
    preferredLanguage: 'zh',
  },

  // ── AI configuration ──
  userRegion: null,
  aiConfig: {
    defaultProvider: 'claude',
    functionOverrides: {},
    apiKeys: {},
    selectedModels: {},
  },
  connectionStatuses: {},

  // ── STT configuration ──
  sttEngine: 'deepgram',
  sttApiKeys: {},

  // ── App settings ──
  appSettings: {
    theme: 'system',
    windowOpacity: 0.95,
    windowAlwaysOnTop: true,
    fontSize: 'medium',
    autoStartRecording: false,
    summaryIntervalMinutes: 5,
    audioRetentionDays: 30,
    micDeviceId: 'default',
    micDeviceLabel: 'Default Microphone',
    sysAudioDeviceId: '',
    sysAudioDeviceLabel: '',
    sysAudioMacAppPid: 0,
    sysAudioMacAppLabel: '',
    outputDeviceId: 'default',
    outputDeviceLabel: 'Default Speaker',
    localWhisperModel: 'base',
  },

  // ── Glossary ──
  customTerms: [],

  // ── Test results (in-memory only) ──
  aiTestResults: {},
  sttTestResult: { status: 'idle' },

  // ── Actions ──

  /** Load all settings from electron-store on startup */
  loadFromStore: async () => {
    if (!window.electronAPI) {
      console.warn('[Settings] electronAPI not available, using defaults');
      set({ settingsLoaded: true });
      return;
    }
    try {
      const all = await window.electronAPI.settings.get('all') as Record<string, unknown> | null;
      if (!all) { set({ settingsLoaded: true }); return; }

      const aiConfigRaw = all.aiConfig as Record<string, unknown> | undefined;
      const userRegion = (all.userRegion as 'global' | 'china' | null) || null;

      // Normalize the persisted STT configuration. migrateSTTConfig handles
      // three legacy cases (removed engine IDs like `aliyun_speech`, stub
      // engines like `local_whisper`, and missing values) by returning a
      // selectable engine plus a pruned key map. We must write the result
      // back to disk — keeping the migration in memory only would mean the
      // user re-encounters the broken state on the next launch, and orphan
      // API keys would survive in encrypted storage indefinitely.
      const migration = migrateSTTConfig(
        all.sttEngine as string | undefined,
        all.sttApiKeys as Record<string, string> | undefined,
        userRegion,
      );

      set({
        settingsLoaded: true,
        legalAccepted: (all.legalAccepted as boolean) || false,
        isFirstLaunch: all.isFirstLaunch !== false, // default true
        userRegion,
        aiConfig: {
          defaultProvider: (aiConfigRaw?.defaultProvider as AIProviderId) || 'claude',
          functionOverrides: (aiConfigRaw?.functionOverrides as Record<string, AIProviderId>) || {},
          apiKeys: (aiConfigRaw?.apiKeys as Record<string, string>) || {},
          selectedModels: (aiConfigRaw?.selectedModels as Record<string, string>) || {},
        },
        sttEngine: migration.engine,
        sttApiKeys: migration.apiKeys,
        userProfile: (all.userProfile as UserProfile) || get().userProfile,
        appSettings: { ...get().appSettings, ...(all.appSettings as Partial<AppSettings>) },
        customTerms: (all.customTerms as Array<{ source: string; target: string }>) || [],
      });

      // Persist anything the migration changed so the broken state does not
      // resurface on next launch.
      if (migration.engineChanged) {
        persist('sttEngine', migration.engine);
      }
      for (const orphanEngineId of migration.prunedKeys) {
        // setEncryptedSttApiKey deletes the entry when apiKey is empty.
        persist('sttApiKey', { engine: orphanEngineId, apiKey: '' });
      }
    } catch (err) {
      console.error('[Settings] Failed to load settings:', err);
      set({ settingsLoaded: true });
    }
  },

  acceptLegal: () => {
    set({ legalAccepted: true });
    persist('legalAccepted', true);
  },

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () => {
    set({ isFirstLaunch: false });
    persist('isFirstLaunch', false);
    // Persist all config at completion
    const s = get();
    persist('userRegion', s.userRegion);
    persist('aiConfig', {
      defaultProvider: s.aiConfig.defaultProvider,
      functionOverrides: s.aiConfig.functionOverrides || {},
      selectedModels: s.aiConfig.selectedModels || {},
    });
    persist('sttEngine', s.sttEngine);
    persist('userProfile', s.userProfile);
  },

  setUserRegion: (region) => {
    const nextDefaultProvider: AIProviderId = region === 'china' ? 'deepseek' : 'claude';
    const nextSttEngine = getDefaultSTTEngineForRegion(region);
    set((state) => ({
      userRegion: region,
      aiConfig: {
        ...state.aiConfig,
        defaultProvider: nextDefaultProvider,
      },
      // Delegate to the helper instead of hard-coding xfyun for China.
      // The helper walks a fallback list and only returns engines for which
      // isSelectableSTTEngine is true, so this stays correct even when an
      // engine's status flips (e.g. xfyun → planned today, future Stable).
      sttEngine: nextSttEngine,
    }));
    // Persist BOTH the region change and every value the store derived
    // from it. Without this the user's first launch after picking China
    // saw sttEngine=deepgram (or deepseek) in memory but the next launch
    // re-loaded the old (or default-default) values from disk.
    persist('userRegion', region);
    persist('sttEngine', nextSttEngine);
    const s = get();
    persist('aiConfig', {
      defaultProvider: nextDefaultProvider,
      functionOverrides: s.aiConfig.functionOverrides || {},
      selectedModels: s.aiConfig.selectedModels || {},
    });
  },

  setDefaultProvider: (id) => {
    set((state) => ({
      aiConfig: { ...state.aiConfig, defaultProvider: id },
    }));
    const s = get();
    persist('aiConfig', {
      defaultProvider: s.aiConfig.defaultProvider,
      functionOverrides: s.aiConfig.functionOverrides || {},
      selectedModels: s.aiConfig.selectedModels || {},
    });
  },

  setApiKey: (provider, key) => {
    set((state) => ({
      aiConfig: {
        ...state.aiConfig,
        apiKeys: { ...state.aiConfig.apiKeys, [provider]: key },
      },
      connectionStatuses: {
        ...state.connectionStatuses,
        [provider]: key ? 'untested' : 'unconfigured',
      },
    }));
    // Encrypt and persist via electron-store
    persist('apiKey', { provider, apiKey: key });
  },

  setConnectionStatus: (provider, status) => {
    set((state) => ({
      connectionStatuses: { ...state.connectionStatuses, [provider]: status },
    }));
  },

  getConnectionStatus: (provider) => {
    const state = get();
    const hasKey = !!state.aiConfig.apiKeys[provider];
    if (!hasKey) return 'unconfigured';
    return state.connectionStatuses[provider] || 'untested';
  },

  setFunctionOverride: (fn, provider) => {
    set((state) => ({
      aiConfig: {
        ...state.aiConfig,
        functionOverrides: { ...state.aiConfig.functionOverrides, [fn]: provider },
      },
    }));
    const s = get();
    persist('aiConfig', {
      defaultProvider: s.aiConfig.defaultProvider,
      functionOverrides: s.aiConfig.functionOverrides || {},
      selectedModels: s.aiConfig.selectedModels || {},
    });
  },

  setSelectedModel: (provider, modelId) => {
    set((state) => ({
      aiConfig: {
        ...state.aiConfig,
        selectedModels: { ...state.aiConfig.selectedModels, [provider]: modelId },
      },
    }));
    const s = get();
    persist('aiConfig', {
      defaultProvider: s.aiConfig.defaultProvider,
      functionOverrides: s.aiConfig.functionOverrides || {},
      selectedModels: s.aiConfig.selectedModels || {},
    });
  },

  setSTTEngine: (id) => {
    // Store-level guard: reject any attempt to set the active engine to a
    // planned / non-selectable id, even if a UI gating bug or stale code
    // path lets one through. The previous behavior relied entirely on
    // SettingsModal / OnboardingWizard never offering planned engines as
    // clickable — that's too much rope. Now the store itself normalizes:
    // selectable values are accepted; everything else is replaced with the
    // region default (which the store has already validated).
    const safeId = isSelectableSTTEngine(id)
      ? id
      : getDefaultSTTEngineForRegion(get().userRegion);
    set({ sttEngine: safeId });
    persist('sttEngine', safeId);
  },

  setSTTApiKey: (engine, key) => {
    // Mirror the guard on setSTTEngine: even if a stray callsite tries to
    // store an API key for a non-selectable engine (e.g. via a debug
    // shortcut or a future feature flag that gets shipped half-baked),
    // refuse the write. Letting the key land would leave a secret in
    // encrypted storage that the next migration would then have to clean
    // up.
    if (!isSelectableSTTEngine(engine)) {
      console.warn(`[Settings] setSTTApiKey ignored — ${engine} is not currently selectable`);
      return;
    }
    // Also refuse keyless engines (local_whisper, requiresApiKey:false):
    // they need no key, so any value here is dead data. migrateSTTConfig
    // already prunes such keys on load, but enforcing the invariant at
    // the WRITE path too keeps a stray value from ever landing.
    const info = STT_ENGINE_INFO.find(e => e.id === engine);
    if (info && !info.requiresApiKey) {
      console.warn(`[Settings] setSTTApiKey ignored — ${engine} is keyless`);
      return;
    }
    set((state) => ({
      sttApiKeys: { ...state.sttApiKeys, [engine]: key },
    }));
    persist('sttApiKey', { engine, apiKey: key });
  },

  updateUserProfile: (profile) => {
    set((state) => ({
      userProfile: { ...state.userProfile, ...profile },
    }));
    persist('userProfile', get().userProfile);
  },

  updateAppSettings: (settings) => {
    set((state) => ({
      appSettings: { ...state.appSettings, ...settings },
    }));
    persist('appSettings', get().appSettings);
  },

  addCustomTerm: (source, target) => {
    set((state) => ({
      customTerms: [...state.customTerms, { source, target }],
    }));
    persist('customTerms', get().customTerms);
  },

  removeCustomTerm: (index) => {
    set((state) => ({
      customTerms: state.customTerms.filter((_, i) => i !== index),
    }));
    persist('customTerms', get().customTerms);
  },

  setAiTestResult: (provider, result) => {
    set((state) => ({
      aiTestResults: { ...state.aiTestResults, [provider]: result },
    }));
  },
  setSttTestResult: (result) => {
    set({ sttTestResult: result });
  },

  openSettingsModal: (tab?: unknown) => {
    const validTabs = ['ai', 'stt', 'profile', 'app'];
    const resolvedTab = typeof tab === 'string' && validTabs.includes(tab) ? tab as 'ai' | 'stt' | 'profile' | 'app' : null;
    set({ settingsModalOpen: true, settingsModalTab: resolvedTab });
  },
  closeSettingsModal: () => set({ settingsModalOpen: false, settingsModalTab: null }),
}));
