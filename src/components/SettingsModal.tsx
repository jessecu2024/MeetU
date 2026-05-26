// ============================================================
// Settings Modal / 设置面板
// Allows users to modify AI provider, API keys, STT engine,
// user profile, and app preferences at any time.
// Bilingual: English first, Chinese second
// ============================================================

import { useState, useEffect } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import type { TestResult } from '../stores/settings-store';
import { providerRegistry } from '../services/ai-provider';
import { sttRegistry } from '../services/stt-engine/engine-registry';
import { listAudioDevices, listAudioOutputDevices, SYSTEM_AUDIO_DEVICE_ID } from '../services/audio/capture';
import type { AudioInputDevice, AudioOutputDevice } from '../services/audio/capture';
import type { AIProviderId } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';
import { STT_ENGINE_INFO, isSelectableSTTEngine, isSTTEngineVisibleForRegion } from '../services/stt-engine/types';

type Tab = 'ai' | 'stt' | 'profile' | 'app';

const TABS: Array<{ id: Tab; en: string; zh: string }> = [
  { id: 'ai', en: 'AI Provider', zh: 'AI 提供商' },
  { id: 'stt', en: 'Speech Engine', zh: '语音引擎' },
  { id: 'profile', en: 'Profile', zh: '个人信息' },
  { id: 'app', en: 'Preferences', zh: '偏好设置' },
];

const API_KEY_PLACEHOLDERS: Record<AIProviderId, string> = {
  claude: 'sk-ant-...',
  openai: 'sk-...',
  gemini: 'AIza...',
  deepseek: 'sk-...',
  qwen: 'sk-...',
  minimax: 'eyJ...',
  glm: '...',
};

export default function SettingsModal() {
  const store = useSettingsStore();
  const [activeTab, setActiveTab] = useState<Tab>(store.settingsModalTab || 'ai');
  const [editingKey, setEditingKey] = useState('');
  const [editingProvider, setEditingProvider] = useState<AIProviderId | null>(null);
  const [sttKeyDraft, setSttKeyDraft] = useState('');
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [showStereoMixGuide, setShowStereoMixGuide] = useState(false);
  const [systemAudioProbe, setSystemAudioProbe] = useState<{
    supported: boolean;
    mode?: 'electron-loopback' | 'macos-native';
    perAppCapture?: boolean;
    reason?: string;
    permission?: string;
    version?: string;
  } | null>(null);
  // macOS native per-app picker: the capturable application list.
  const [macApps, setMacApps] = useState<Array<{ pid: number; name: string; bundleId: string }>>([]);
  const [macAppsError, setMacAppsError] = useState<string | null>(null);

  // Read test results from store (persists across modal open/close)
  const aiTestResults = useSettingsStore((s) => s.aiTestResults);
  const sttTestResult = useSettingsStore((s) => s.sttTestResult);

  useEffect(() => {
    if (activeTab === 'app') {
      listAudioDevices().then(setAudioDevices);
      listAudioOutputDevices().then(setOutputDevices);
      // Probe whether system-audio loopback is available on this OS. We
      // gate the dropdown option on the result so users on macOS 12 /
      // Linux see an explanation instead of a silent failure when they
      // try to record.
      //
      // If the user previously persisted SYSTEM_AUDIO_DEVICE_ID on a
      // supported OS and is now on an unsupported one (downgrade, new
      // machine, etc.), auto-reset to the default microphone so the
      // user does not have to deduce that the persisted-but-disabled
      // sentinel is the reason their next recording fails.
      // Both branches (success-but-unsupported AND probe IPC rejection)
      // must auto-reset a persisted SYSTEM_AUDIO_DEVICE_ID — otherwise
      // a user who previously selected system audio on a supported OS
      // and is now on an unsupported one (downgrade, new machine, dev
      // mismatch) sees a disabled card AND a hidden sentinel still
      // active, with no path forward except to figure out the
      // mismatch unaided.
      const resetSentinelIfUnsupported = () => {
        if (useSettingsStore.getState().appSettings.micDeviceId === SYSTEM_AUDIO_DEVICE_ID) {
          useSettingsStore.getState().updateAppSettings({
            micDeviceId: 'default',
            micDeviceLabel: 'Default Microphone',
          });
        }
      };
      window.electronAPI?.audio.probeSystemAudio()
        .then((probe) => {
          setSystemAudioProbe(probe);
          if (!probe.supported) resetSentinelIfUnsupported();
        })
        .catch(() => {
          setSystemAudioProbe({ supported: false, reason: 'Probe failed' });
          resetSentinelIfUnsupported();
        });
    }
  }, [activeTab]);

  const handleTestConnection = async (providerId: AIProviderId) => {
    store.setAiTestResult(providerId, { status: 'testing' });
    const start = Date.now();
    try {
      const provider = providerRegistry.get(providerId);
      if (!provider) throw new Error('Provider not found');
      const result = await provider.testConnection();
      const latencyMs = Date.now() - start;
      store.setAiTestResult(providerId, result.ok
        ? { status: 'ok', latencyMs }
        : { status: 'error', error: result.error || 'Connection failed' });
    } catch (err) {
      store.setAiTestResult(providerId, {
        status: 'error', error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const handleTestSTT = async (engineId: STTEngineId, apiKey: string) => {
    if (!apiKey.trim()) return;
    store.setSttTestResult({ status: 'testing' });
    const start = Date.now();
    try {
      const engine = sttRegistry.get(engineId);
      if (!engine) throw new Error('Engine not found');
      engine.setApiKey(apiKey);
      const result = await engine.testConnection();
      const latencyMs = Date.now() - start;
      store.setSttTestResult(result.ok
        ? { status: 'ok', latencyMs }
        : { status: 'error', error: result.error || 'Connection failed' });
    } catch (err) {
      store.setSttTestResult({
        status: 'error', error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const allProviders = providerRegistry.getAll();
  const regionProviders = store.userRegion
    ? providerRegistry.getByRegion(store.userRegion)
    : allProviders;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md mx-4
        max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
              Settings
            </h2>
            <p className="text-xs text-zinc-500">设置</p>
          </div>
          <button
            onClick={store.closeSettingsModal}
            className="w-8 h-8 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-700 px-5">
          {TABS.map(tab => (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2 px-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}>
              {tab.en}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── AI Provider Tab ── */}
          {activeTab === 'ai' && (
            <>
              {/* Default provider */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Default AI Provider <span className="text-zinc-400 font-normal">/ 默认 AI 提供商</span>
                </label>
                <div className="space-y-2">
                  {regionProviders.map(p => {
                    const hasKey = !!store.aiConfig.apiKeys[p.id];
                    const isDefault = store.aiConfig.defaultProvider === p.id;
                    return (
                      <div key={p.id}
                        className={`p-3 rounded-xl border transition-all ${
                          isDefault
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-zinc-200 dark:border-zinc-700'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => store.setDefaultProvider(p.id)}
                                className="font-medium text-sm text-zinc-900 dark:text-white hover:text-blue-600">
                                {p.nameEn}
                              </button>
                              {isDefault && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                  Default
                                </span>
                              )}
                              {hasKey ? (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                  Key ✓
                                </span>
                              ) : (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                                  No Key
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 ml-2">
                            <button
                              onClick={() => {
                                setEditingProvider(editingProvider === p.id ? null : p.id);
                                setEditingKey(store.aiConfig.apiKeys[p.id] || '');
                              }}
                              className="text-xs px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-600
                                text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                              {editingProvider === p.id ? 'Cancel' : 'Edit Key'}
                            </button>
                            {hasKey && (() => {
                              const tr = aiTestResults[p.id] as TestResult | undefined;
                              const st = tr?.status || 'idle';
                              return (
                                <button
                                  onClick={() => handleTestConnection(p.id)}
                                  disabled={st === 'testing'}
                                  title={st === 'error' ? tr?.error : undefined}
                                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                                    st === 'ok'
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : st === 'error'
                                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200'
                                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200'
                                  }`}>
                                  {st === 'testing' ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
                                      Testing...
                                    </span>
                                  ) : st === 'ok' ? (
                                    `✅ ${tr?.latencyMs ? tr.latencyMs + 'ms' : 'OK'}`
                                  ) : st === 'error' ? (
                                    '❌ Retry'
                                  ) : 'Test'}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Test result message — persists across modal open/close */}
                        {aiTestResults[p.id]?.status === 'ok' && (
                          <p className="mt-1.5 text-xs text-green-600 dark:text-green-400">
                            ✅ Connected {aiTestResults[p.id]?.latencyMs ? `(${aiTestResults[p.id]!.latencyMs}ms)` : ''}
                          </p>
                        )}
                        {aiTestResults[p.id]?.status === 'error' && aiTestResults[p.id]?.error && (
                          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                            ❌ {aiTestResults[p.id]!.error}
                          </p>
                        )}

                        {/* Edit Key Inline */}
                        {editingProvider === p.id && (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="password"
                              value={editingKey}
                              onChange={(e) => setEditingKey(e.target.value)}
                              placeholder={API_KEY_PLACEHOLDERS[p.id] || '...'}
                              className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600
                                bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                store.setApiKey(p.id, editingKey);
                                const provider = providerRegistry.get(p.id);
                                if (provider) provider.setApiKey(editingKey);
                                setEditingProvider(null);
                                setEditingKey('');
                                if (editingKey.trim()) {
                                  handleTestConnection(p.id);
                                }
                              }}
                              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Model selection for default provider */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Model <span className="text-zinc-400 font-normal">/ 模型</span>
                </label>
                {(() => {
                  const provider = providerRegistry.get(store.aiConfig.defaultProvider);
                  if (!provider) return null;
                  return (
                    <div className="space-y-1.5">
                      {provider.models.map(m => (
                        <button key={m.id}
                          onClick={() => {
                            store.setSelectedModel(provider.id, m.id);
                            provider.currentModel = m.id;
                          }}
                          className={`w-full p-2.5 rounded-lg border text-left text-sm transition-all ${
                            (store.aiConfig.selectedModels[provider.id] || provider.currentModel) === m.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-zinc-900 dark:text-white">{m.name}</span>
                            <span className="text-xs text-zinc-400">
                              {m.tier === 'fast' ? 'Fast' : m.tier === 'balanced' ? 'Balanced' : 'Powerful'}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5">
                            In ${m.inputPrice}/M · Out ${m.outputPrice}/M · {Math.round(m.contextWindow / 1000)}K ctx
                          </p>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Not configured warning */}
              {!store.aiConfig.apiKeys[store.aiConfig.defaultProvider] && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Not configured — AI features (translation, summary, speech suggestions) are disabled.
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    未配置 API Key — AI 功能（翻译、摘要、发言建议）已禁用。
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── STT Engine Tab ── */}
          {activeTab === 'stt' && (
            <>
              <div className="space-y-2">
                {STT_ENGINE_INFO
                  .filter(e => isSTTEngineVisibleForRegion(e, store.userRegion))
                  .map(engine => {
                    const selectable = isSelectableSTTEngine(engine.id);
                    const isPlanned = !selectable;
                    const isBeta = engine.status === 'beta';
                    return (
                      <button key={engine.id}
                        onClick={() => selectable && store.setSTTEngine(engine.id as STTEngineId)}
                        disabled={!selectable}
                        className={`w-full p-3 rounded-xl border text-left transition-all ${
                          isPlanned ? 'opacity-50 cursor-not-allowed' : ''
                        } ${
                          store.sttEngine === engine.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-zinc-900 dark:text-white">{engine.nameEn}</p>
                            <p className="text-xs text-zinc-500">{engine.descriptionEn} / {engine.description}</p>
                            <p className="text-xs text-zinc-400 mt-0.5">{engine.pricing}</p>
                            {(isBeta || isPlanned) && engine.statusNote && (
                              <p className={`text-xs mt-1 ${isPlanned ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                ⚠ {engine.statusNote}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 ml-2 shrink-0">
                            {isPlanned && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">Planned</span>
                            )}
                            {isBeta && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Beta</span>
                            )}
                            {engine.region === 'local' && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">Offline</span>
                            )}
                            {!engine.requiresApiKey && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">No Key</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>

              {/* STT API Key input */}
              {(() => {
                const currentEngine = STT_ENGINE_INFO.find(e => e.id === store.sttEngine);
                if (!currentEngine?.requiresApiKey) return null;
                const savedKey = store.sttApiKeys[store.sttEngine] || '';
                return (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {currentEngine.nameEn} API Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={sttKeyDraft || savedKey}
                        onChange={(e) => setSttKeyDraft(e.target.value)}
                        placeholder="Enter API Key..."
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600
                          bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          const key = sttKeyDraft || savedKey;
                          if (key.trim()) {
                            store.setSTTApiKey(store.sttEngine, key);
                            setSttKeyDraft('');
                            handleTestSTT(store.sttEngine, key);
                          }
                        }}
                        className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                        Save
                      </button>
                    </div>

                    {/* STT test result — persists across modal open/close */}
                    {sttTestResult.status !== 'idle' && (
                      <div className="mt-2">
                        {sttTestResult.status === 'testing' && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                            <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
                            Testing connection... / 测试中...
                          </span>
                        )}
                        {sttTestResult.status === 'ok' && (
                          <p className="text-xs text-green-700 dark:text-green-400">
                            ✅ Connected {sttTestResult.latencyMs ? `(${sttTestResult.latencyMs}ms)` : ''}
                          </p>
                        )}
                        {sttTestResult.status === 'error' && (
                          <div>
                            <p className="text-xs text-red-600 dark:text-red-400">
                              ❌ {sttTestResult.error}
                            </p>
                            <button
                              onClick={() => handleTestSTT(store.sttEngine, savedKey)}
                              className="mt-1 text-xs text-blue-600 hover:underline">
                              Retry / 重试
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {currentEngine.apiKeyGuideUrl && (
                      <a href={currentEngine.apiKeyGuideUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                        Get API Key / 获取 API Key →
                      </a>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {/* ── Profile Tab ── */}
          {activeTab === 'profile' && (
            <>
              {[
                { key: 'name', en: 'Chinese Name', zh: '中文名', placeholder: 'e.g. 张明' },
                { key: 'nameEn', en: 'English Name', zh: '英文名', placeholder: 'e.g. Michael Zhang' },
                { key: 'role', en: 'Role / Title', zh: '职位/角色', placeholder: 'e.g. Product Manager' },
              ].map(({ key, en, zh, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {en} <span className="text-zinc-400 font-normal">/ {zh}</span>
                  </label>
                  <input type="text" placeholder={placeholder}
                    value={(store.userProfile as unknown as Record<string, string>)[key] || ''}
                    onChange={(e) => store.updateUserProfile({ [key]: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                      bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              ))}
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">
                  Used to detect when someone mentions you in a meeting. All data stored locally only.
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  用于检测别人是否在叫你/问你问题。所有信息仅存储在本地。
                </p>
              </div>
            </>
          )}

          {/* ── App Preferences Tab ── */}
          {activeTab === 'app' && (
            <>
              {/* Theme */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Theme <span className="text-zinc-400 font-normal">/ 主题</span>
                </label>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as const).map(t => (
                    <button key={t}
                      onClick={() => store.updateAppSettings({ theme: t })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        store.appSettings.theme === t
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                      }`}>
                      {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Font Size <span className="text-zinc-400 font-normal">/ 字体大小</span>
                </label>
                <div className="flex gap-2">
                  {(['small', 'medium', 'large'] as const).map(s => (
                    <button key={s}
                      onClick={() => store.updateAppSettings({ fontSize: s })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        store.appSettings.fontSize === s
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                      }`}>
                      {s === 'small' ? 'Small' : s === 'medium' ? 'Medium' : 'Large'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Window opacity */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Window Opacity <span className="text-zinc-400 font-normal">/ 窗口透明度</span>
                  <span className="ml-2 text-xs text-zinc-400">{Math.round(store.appSettings.windowOpacity * 100)}%</span>
                </label>
                <input type="range" min="50" max="100"
                  value={store.appSettings.windowOpacity * 100}
                  onChange={(e) => {
                    const opacity = Number(e.target.value) / 100;
                    store.updateAppSettings({ windowOpacity: opacity });
                    window.electronAPI?.window.setOpacity(opacity);
                  }}
                  className="w-full" />
              </div>

              {/* Summary interval */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Summary Interval <span className="text-zinc-400 font-normal">/ 摘要间隔</span>
                </label>
                <select
                  value={store.appSettings.summaryIntervalMinutes}
                  onChange={(e) => store.updateAppSettings({ summaryIntervalMinutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value={3}>3 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                </select>
              </div>

              {/* Quick Setup Presets */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Quick Setup <span className="text-zinc-400 font-normal">/ 快捷配置</span>
                </label>
                <div className="space-y-1.5">
                  {/* Preset A: Wired headset */}
                  <button
                    onClick={() => {
                      const wired = audioDevices.find(d => d.type === 'mic');
                      if (wired) store.updateAppSettings({ micDeviceId: wired.deviceId, micDeviceLabel: wired.label });
                    }}
                    className="w-full p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-left text-xs hover:border-blue-400 transition-colors">
                    <span className="font-medium text-zinc-900 dark:text-white">🎧 Wired Headset / 有线耳机</span>
                    <p className="text-zinc-400 mt-0.5">Your voice captured, meeting audio plays normally / 录制你的声音，正常听会议</p>
                  </button>

                  {/* Preset B: Stereo Mix */}
                  <button
                    onClick={() => {
                      const sm = audioDevices.find(d => d.type === 'stereo_mix');
                      if (sm) {
                        store.updateAppSettings({ micDeviceId: sm.deviceId, micDeviceLabel: sm.label });
                      } else {
                        setShowStereoMixGuide(true);
                      }
                    }}
                    className="w-full p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-left text-xs hover:border-blue-400 transition-colors">
                    <span className="font-medium text-zinc-900 dark:text-white">🔊 Record Meeting Audio / 录制会议声音</span>
                    <p className="text-zinc-400 mt-0.5">
                      {audioDevices.some(d => d.type === 'stereo_mix')
                        ? 'Stereo Mix available — captures all system audio / 立体声混音可用'
                        : 'Requires enabling Stereo Mix — click for guide / 需要启用立体声混音'}
                    </p>
                  </button>

                  {/* Preset C: Bluetooth */}
                  {audioDevices.some(d => d.type === 'bluetooth') && (
                    <button
                      onClick={() => {
                        const bt = audioDevices.find(d => d.type === 'bluetooth');
                        if (bt) store.updateAppSettings({ micDeviceId: bt.deviceId, micDeviceLabel: bt.label });
                      }}
                      className="w-full p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-left text-xs hover:border-blue-400 transition-colors">
                      <span className="font-medium text-zinc-900 dark:text-white">🔵 Bluetooth Headset / 蓝牙耳机</span>
                      <p className="text-zinc-400 mt-0.5">Your voice only. For meeting audio, also enable Stereo Mix / 仅录你的声音。如需会议声音请启用立体声混音</p>
                    </button>
                  )}
                </div>
              </div>

              {/* System Audio — driverless system-output capture.
                  Backend depends on the probe `mode`:
                    - 'electron-loopback' (Windows 10+): getDisplayMedia
                      + WASAPI loopback, whole-system only.
                    - 'macos-native' (macOS 13+): native ScreenCaptureKit
                      addon, supports both whole-system and per-app
                      capture (the per-app picker below).
                  Unsupported platforms get a greyed-out card with the
                  probe's reason. */}
              {systemAudioProbe && (
                <div className={`rounded-lg border p-2.5 ${
                  systemAudioProbe.supported
                    ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 opacity-70'
                }`}>
                  <button
                    onClick={() => {
                      if (!systemAudioProbe.supported) return;
                      store.updateAppSettings({
                        micDeviceId: SYSTEM_AUDIO_DEVICE_ID,
                        micDeviceLabel: 'System Audio (loopback)',
                        // Default to whole-system; the per-app picker
                        // below can narrow it on the macOS native path.
                        sysAudioMacAppPid: 0,
                        sysAudioMacAppLabel: '',
                      });
                    }}
                    disabled={!systemAudioProbe.supported}
                    className="w-full text-left text-xs disabled:cursor-not-allowed">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-900 dark:text-white">
                        🔊 System Audio (native loopback) / 系统音频（原生 loopback）
                      </span>
                      {store.appSettings.micDeviceId === SYSTEM_AUDIO_DEVICE_ID && systemAudioProbe.supported && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ selected</span>
                      )}
                    </div>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {!systemAudioProbe.supported
                        ? (systemAudioProbe.reason || 'Not supported on this OS')
                        : systemAudioProbe.mode === 'macos-native'
                          ? 'macOS 13+ ScreenCaptureKit · no driver needed · supports per-app capture below / macOS 13+ 原生 ScreenCaptureKit，无需驱动，支持下方按应用捕获'
                          : 'Windows 10+ WASAPI loopback · no driver needed / Windows 10+ WASAPI loopback，无需驱动'}
                    </p>
                    {systemAudioProbe.supported && systemAudioProbe.mode === 'macos-native' && systemAudioProbe.permission === 'denied' && (
                      <p className="mt-1 text-amber-600 dark:text-amber-400">
                        ⚠ Screen &amp; System Audio Recording permission is denied. Grant it in System Settings → Privacy &amp; Security, then restart MeetU. / 屏幕与系统录制权限被拒绝，请在 系统设置 → 隐私与安全 中授权后重启
                      </p>
                    )}
                  </button>

                  {/* Per-app picker — macOS native path only. Lets the
                      user capture a single application's audio (e.g.
                      only Zoom) instead of the whole-system mix. */}
                  {systemAudioProbe.supported
                    && systemAudioProbe.perAppCapture
                    && store.appSettings.micDeviceId === SYSTEM_AUDIO_DEVICE_ID && (
                    <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          Capture target / 捕获目标
                        </span>
                        <button
                          onClick={async () => {
                            setMacAppsError(null);
                            const res = await window.electronAPI?.audio.macos.listApps();
                            if (res?.ok) {
                              setMacApps(res.apps);
                            } else {
                              setMacAppsError(res?.error || 'Failed to list applications');
                            }
                          }}
                          className="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          Refresh apps / 刷新应用
                        </button>
                      </div>
                      <select
                        value={store.appSettings.sysAudioMacAppPid}
                        onChange={(e) => {
                          const pid = Number(e.target.value);
                          const app = macApps.find(a => a.pid === pid);
                          store.updateAppSettings({
                            sysAudioMacAppPid: pid,
                            sysAudioMacAppLabel: app?.name || '',
                          });
                        }}
                        className="w-full px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600
                          bg-white dark:bg-zinc-800 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none">
                        <option value={0}>🔊 Whole system audio / 整个系统音频</option>
                        {macApps.map(a => (
                          <option key={a.pid} value={a.pid}>
                            {a.name || a.bundleId || `pid ${a.pid}`}
                          </option>
                        ))}
                        {/* Keep the persisted selection visible even if
                            the app isn't in the refreshed list (it may
                            have quit, or the list hasn't loaded yet). */}
                        {store.appSettings.sysAudioMacAppPid > 0
                          && !macApps.some(a => a.pid === store.appSettings.sysAudioMacAppPid) && (
                          <option value={store.appSettings.sysAudioMacAppPid}>
                            {store.appSettings.sysAudioMacAppLabel || `pid ${store.appSettings.sysAudioMacAppPid}`} (not running?)
                          </option>
                        )}
                      </select>
                      {macAppsError && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{macAppsError}</p>
                      )}
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Per-app capture records only the selected application&apos;s audio. The pid changes each launch — re-pick if you restart the app. / 按应用捕获只录选定应用的声音；pid 每次启动会变，重启该应用后需重新选择
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Audio Input Device selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Audio Input Device <span className="text-zinc-400 font-normal">/ 音频输入设备</span>
                </label>
                <select
                  value={
                    store.appSettings.micDeviceId === SYSTEM_AUDIO_DEVICE_ID
                      ? ''
                      : store.appSettings.micDeviceId
                  }
                  onChange={(e) => {
                    const d = audioDevices.find(x => x.deviceId === e.target.value);
                    store.updateAppSettings({ micDeviceId: e.target.value, micDeviceLabel: d?.label || 'Default' });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {store.appSettings.micDeviceId === SYSTEM_AUDIO_DEVICE_ID && (
                    <option value="" disabled>(System Audio selected above)</option>
                  )}
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.badge} {d.label}
                    </option>
                  ))}
                </select>
                {audioDevices.length === 0 && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    No audio input detected. Please connect a microphone.
                    <span className="block text-red-500">未检测到音频输入设备，请连接麦克风。</span>
                  </p>
                )}

                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={() => { listAudioDevices().then(setAudioDevices); listAudioOutputDevices().then(setOutputDevices); }}
                    className="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600
                      text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    Refresh Devices / 刷新设备
                  </button>
                  <button
                    onClick={() => setShowStereoMixGuide(!showStereoMixGuide)}
                    className="text-xs text-blue-600 hover:underline">
                    {showStereoMixGuide ? 'Hide guide ▲' : 'Stereo Mix guide / 立体声混音指南 ▼'}
                  </button>
                </div>
              </div>

              {/* Stereo Mix setup guide */}
              {showStereoMixGuide && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs space-y-2">
                  <p className="font-medium text-blue-800 dark:text-blue-300">
                    How to enable Stereo Mix / 如何启用立体声混音
                  </p>
                  <p className="text-blue-700 dark:text-blue-400">
                    Stereo Mix captures everything playing through your speakers/headphones — perfect for recording meeting audio.
                  </p>
                  <p className="text-blue-600 dark:text-blue-500">
                    立体声混音可以录制扬声器/耳机播放的所有声音——非常适合录制会议声音。
                  </p>
                  <ol className="list-decimal list-inside space-y-0.5 text-blue-700 dark:text-blue-400 mt-1">
                    <li>Right-click volume icon in taskbar → Sounds / 右键任务栏音量图标 → 声音</li>
                    <li>Click &quot;Recording&quot; tab / 点击&quot;录制&quot;标签</li>
                    <li>Right-click empty area → &quot;Show Disabled Devices&quot; / 右键空白处 → &quot;显示已禁用的设备&quot;</li>
                    <li>Right-click &quot;Stereo Mix&quot; → &quot;Enable&quot; / 右键&quot;立体声混音&quot; → &quot;启用&quot;</li>
                    <li>Click &quot;Apply&quot; → Refresh device list above / 点击&quot;应用&quot; → 刷新上方设备列表</li>
                  </ol>
                  <p className="text-blue-600 dark:text-blue-500 mt-1 border-t border-blue-200 dark:border-blue-700 pt-1">
                    Note: Some audio drivers don&apos;t support Stereo Mix. Use a virtual audio cable like VB-Cable (free) instead.
                    <span className="block">注意：部分声卡不支持立体声混音。可使用虚拟音频线缆如 VB-Cable（免费）。</span>
                  </p>
                </div>
              )}

              {/* Audio Output Device */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Audio Output <span className="text-zinc-400 font-normal">/ 音频输出（听声音）</span>
                </label>
                <select
                  value={store.appSettings.outputDeviceId}
                  onChange={(e) => {
                    const d = outputDevices.find(x => x.deviceId === e.target.value);
                    store.updateAppSettings({ outputDeviceId: e.target.value, outputDeviceLabel: d?.label || 'Default' });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {outputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}{d.isBluetooth ? ' 🔵' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Network Region <span className="text-zinc-400 font-normal">/ 网络环境</span>
                </label>
                <div className="flex gap-2">
                  {(['global', 'china'] as const).map(r => (
                    <button key={r}
                      onClick={() => store.setUserRegion(r)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        store.userRegion === r
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                      }`}>
                      {r === 'global' ? 'Global' : 'China'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={store.closeSettingsModal}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-medium
              hover:bg-blue-700 transition-colors text-sm">
            Done / 完成
          </button>
        </div>
      </div>
    </div>
  );
}
