// ============================================================
// Settings Store (Zustand)
// Manages user settings with electron-store persistence
// API Keys are encrypted via electron's safeStorage
// ============================================================

import { create } from 'zustand';
import type { AIProviderId, AIFunction, UserAIConfig } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';

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
        getDesktopSourceId: () => Promise<string | null>;
        onChunk: (cb: (chunk: ArrayBuffer) => void) => void;
        onLevel: (cb: (level: number) => void) => void;
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
  outputDeviceId: string;
  outputDeviceLabel: string;
  captureMode: 'mic_and_system' | 'mic_only' | 'system_only';
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
    outputDeviceId: 'default',
    outputDeviceLabel: 'Default Speaker',
    captureMode: 'mic_and_system',
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
      set({
        settingsLoaded: true,
        legalAccepted: (all.legalAccepted as boolean) || false,
        isFirstLaunch: all.isFirstLaunch !== false, // default true
        userRegion: (all.userRegion as 'global' | 'china' | null) || null,
        aiConfig: {
          defaultProvider: (aiConfigRaw?.defaultProvider as AIProviderId) || 'claude',
          functionOverrides: (aiConfigRaw?.functionOverrides as Record<string, AIProviderId>) || {},
          apiKeys: (aiConfigRaw?.apiKeys as Record<string, string>) || {},
          selectedModels: (aiConfigRaw?.selectedModels as Record<string, string>) || {},
        },
        sttEngine: (all.sttEngine as STTEngineId) || 'deepgram',
        sttApiKeys: (all.sttApiKeys as Record<string, string>) || {},
        userProfile: (all.userProfile as UserProfile) || get().userProfile,
        appSettings: { ...get().appSettings, ...(all.appSettings as Partial<AppSettings>) },
        customTerms: (all.customTerms as Array<{ source: string; target: string }>) || [],
      });
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
    set((state) => ({
      userRegion: region,
      aiConfig: {
        ...state.aiConfig,
        defaultProvider: region === 'china' ? 'deepseek' : 'claude',
      },
      sttEngine: region === 'china' ? 'xfyun' : 'deepgram',
    }));
    persist('userRegion', region);
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
    set({ sttEngine: id });
    persist('sttEngine', id);
  },

  setSTTApiKey: (engine, key) => {
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
