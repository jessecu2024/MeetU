// ============================================================
// Settings Store (Zustand)
// 管理用户设置，包括 AI 提供商选择、STT 引擎、UI 偏好等
// ============================================================

import { create } from 'zustand';
import type { AIProviderId, AIFunction, UserAIConfig } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';

interface UserProfile {
  name: string;            // 用户姓名（用于@检测）
  nameEn: string;          // 英文名（用于@检测）
  aliases: string[];       // 其他可能被叫到的名字/昵称
  role: string;            // 职位/角色
  preferredLanguage: 'zh' | 'en';  // 偏好语言
}

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  windowOpacity: number;   // 0.5-1.0
  windowAlwaysOnTop: boolean;
  fontSize: 'small' | 'medium' | 'large';
  autoStartRecording: boolean;
  summaryIntervalMinutes: number;  // 摘要更新间隔
  audioRetentionDays: number;      // 音频保留天数
}

interface SettingsState {
  // ── 法律同意状态 ──
  legalAccepted: boolean;

  // ── 初始化状态 ──
  isFirstLaunch: boolean;
  onboardingStep: number;  // 0=选区域, 1=选AI, 2=输入Key, 3=测试, 4=选STT, 5=完成

  // ── 用户资料 ──
  userProfile: UserProfile;

  // ── AI 配置 ──
  userRegion: 'global' | 'china' | null;
  aiConfig: UserAIConfig;

  // ── STT 配置 ──
  sttEngine: STTEngineId;
  sttApiKeys: Partial<Record<STTEngineId, string>>;

  // ── 应用设置 ──
  appSettings: AppSettings;

  // ── 术语表 ──
  customTerms: Array<{ source: string; target: string }>;

  // ── Actions ──
  acceptLegal: () => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  setUserRegion: (region: 'global' | 'china') => void;
  setDefaultProvider: (id: AIProviderId) => void;
  setApiKey: (provider: AIProviderId, key: string) => void;
  setFunctionOverride: (fn: AIFunction, provider: AIProviderId) => void;
  setSelectedModel: (provider: AIProviderId, modelId: string) => void;
  setSTTEngine: (id: STTEngineId) => void;
  setSTTApiKey: (engine: STTEngineId, key: string) => void;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  addCustomTerm: (source: string, target: string) => void;
  removeCustomTerm: (index: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // ── 法律同意状态 ──
  legalAccepted: false,

  // ── 初始化状态 ──
  isFirstLaunch: true,
  onboardingStep: 0,

  // ── 用户资料 ──
  userProfile: {
    name: '',
    nameEn: '',
    aliases: [],
    role: '',
    preferredLanguage: 'zh',
  },

  // ── AI 配置 ──
  userRegion: null,
  aiConfig: {
    defaultProvider: 'claude',
    functionOverrides: {},
    apiKeys: {},
    selectedModels: {},
  },

  // ── STT 配置 ──
  sttEngine: 'deepgram',
  sttApiKeys: {},

  // ── 应用设置 ──
  appSettings: {
    theme: 'system',
    windowOpacity: 0.95,
    windowAlwaysOnTop: true,
    fontSize: 'medium',
    autoStartRecording: false,
    summaryIntervalMinutes: 5,
    audioRetentionDays: 30,
  },

  // ── 术语表 ──
  customTerms: [],

  // ── Actions ──
  acceptLegal: () => set({ legalAccepted: true }),

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  completeOnboarding: () => set({ isFirstLaunch: false }),

  setUserRegion: (region) => set((state) => ({
    userRegion: region,
    aiConfig: {
      ...state.aiConfig,
      defaultProvider: region === 'china' ? 'deepseek' : 'claude',
    },
    sttEngine: region === 'china' ? 'xfyun' : 'deepgram',
  })),

  setDefaultProvider: (id) => set((state) => ({
    aiConfig: { ...state.aiConfig, defaultProvider: id },
  })),

  setApiKey: (provider, key) => set((state) => ({
    aiConfig: {
      ...state.aiConfig,
      apiKeys: { ...state.aiConfig.apiKeys, [provider]: key },
    },
  })),

  setFunctionOverride: (fn, provider) => set((state) => ({
    aiConfig: {
      ...state.aiConfig,
      functionOverrides: { ...state.aiConfig.functionOverrides, [fn]: provider },
    },
  })),

  setSelectedModel: (provider, modelId) => set((state) => ({
    aiConfig: {
      ...state.aiConfig,
      selectedModels: { ...state.aiConfig.selectedModels, [provider]: modelId },
    },
  })),

  setSTTEngine: (id) => set({ sttEngine: id }),

  setSTTApiKey: (engine, key) => set((state) => ({
    sttApiKeys: { ...state.sttApiKeys, [engine]: key },
  })),

  updateUserProfile: (profile) => set((state) => ({
    userProfile: { ...state.userProfile, ...profile },
  })),

  updateAppSettings: (settings) => set((state) => ({
    appSettings: { ...state.appSettings, ...settings },
  })),

  addCustomTerm: (source, target) => set((state) => ({
    customTerms: [...state.customTerms, { source, target }],
  })),

  removeCustomTerm: (index) => set((state) => ({
    customTerms: state.customTerms.filter((_, i) => i !== index),
  })),
}));
