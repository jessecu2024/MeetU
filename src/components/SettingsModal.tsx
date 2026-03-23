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
import { listAudioDevices, listAudioOutputDevices } from '../services/audio/capture';
import type { AudioOutputDevice } from '../services/audio/capture';
import type { AIProviderId } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';
import { STT_ENGINE_INFO } from '../services/stt-engine/types';

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
  const [audioDevices, setAudioDevices] = useState<Array<{ deviceId: string; label: string; isStereoMix: boolean; isBluetooth: boolean }>>([]);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [showAudioGuide, setShowAudioGuide] = useState(false);

  // Read test results from store (persists across modal open/close)
  const aiTestResults = useSettingsStore((s) => s.aiTestResults);
  const sttTestResult = useSettingsStore((s) => s.sttTestResult);

  useEffect(() => {
    if (activeTab === 'app') {
      listAudioDevices().then(setAudioDevices);
      listAudioOutputDevices().then(setOutputDevices);
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
                  .filter(e =>
                    store.userRegion === 'china'
                      ? e.region === 'china' || e.region === 'local'
                      : e.region === 'global' || e.region === 'local')
                  .map(engine => (
                    <button key={engine.id}
                      onClick={() => store.setSTTEngine(engine.id as STTEngineId)}
                      className={`w-full p-3 rounded-xl border text-left transition-all ${
                        store.sttEngine === engine.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-zinc-900 dark:text-white">{engine.nameEn}</p>
                          <p className="text-xs text-zinc-500">{engine.descriptionEn} / {engine.description}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{engine.pricing}</p>
                        </div>
                        <div className="flex flex-col gap-1 ml-2">
                          {engine.region === 'local' && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">Offline</span>
                          )}
                          {!engine.requiresApiKey && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">No Key</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
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

              {/* Bluetooth recommendation banner */}
              {audioDevices.some(d => d.isBluetooth) && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs space-y-1">
                  <p className="font-medium text-blue-800 dark:text-blue-300">
                    Bluetooth headset detected / 检测到蓝牙耳机
                  </p>
                  <p className="text-blue-700 dark:text-blue-400">
                    Recommended: Use Bluetooth mic for input, switch output to speakers to avoid audio cutoff.
                  </p>
                  <p className="text-blue-600 dark:text-blue-500">
                    建议：使用蓝牙麦克风录音，将音频输出切换到扬声器以避免蓝牙音频中断。
                  </p>
                </div>
              )}

              {/* Microphone device (Input) */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Audio Input Device <span className="text-zinc-400 font-normal">/ 音频输入设备（麦克风）</span>
                </label>
                <select
                  value={store.appSettings.micDeviceId}
                  onChange={(e) => {
                    const d = audioDevices.find(x => x.deviceId === e.target.value);
                    store.updateAppSettings({ micDeviceId: e.target.value, micDeviceLabel: d?.label || 'Default' });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  {audioDevices.filter(d => !d.isStereoMix).map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}{d.isBluetooth ? ' 🔵' : ''}
                    </option>
                  ))}
                </select>
                {audioDevices.filter(d => !d.isStereoMix).length === 0 && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    No microphone detected. Please connect a headset with microphone or a USB microphone.
                    <span className="block text-red-500">未检测到麦克风，请连接带麦耳机或 USB 麦克风。</span>
                  </p>
                )}
              </div>

              {/* Audio Output Device */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Audio Output Device <span className="text-zinc-400 font-normal">/ 音频输出设备（听声音）</span>
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
                {/* Bluetooth mic + BT output warning */}
                {audioDevices.some(d => d.isBluetooth) &&
                  outputDevices.find(d => d.deviceId === store.appSettings.outputDeviceId)?.isBluetooth && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Using Bluetooth for both input and output may cause audio quality issues (HFP mode).
                    Consider switching output to speakers.
                    <span className="block text-amber-500">同时使用蓝牙输入和输出可能导致音质下降。建议将输出切换到扬声器。</span>
                  </p>
                )}
              </div>

              {/* System audio device (Stereo Mix) */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  System Audio Capture <span className="text-zinc-400 font-normal">/ 系统音频捕获（录制会议声音）</span>
                </label>
                <select
                  value={store.appSettings.sysAudioDeviceId}
                  onChange={(e) => {
                    const d = audioDevices.find(x => x.deviceId === e.target.value);
                    store.updateAppSettings({ sysAudioDeviceId: e.target.value, sysAudioDeviceLabel: d?.label || '' });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">None — mic only / 无（仅麦克风）</option>
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}{d.isStereoMix ? ' ⭐ Recommended' : ''}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={() => { listAudioDevices().then(setAudioDevices); listAudioOutputDevices().then(setOutputDevices); }}
                    className="text-xs px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600
                      text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    Refresh / 刷新
                  </button>
                  <button
                    onClick={() => setShowAudioGuide(!showAudioGuide)}
                    className="text-xs text-blue-600 hover:underline">
                    {showAudioGuide ? 'Hide guide ▲' : 'Setup guide / 设置指南 ▼'}
                  </button>
                </div>

                {showAudioGuide && (
                  <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs space-y-2">
                    <p className="font-medium text-blue-800 dark:text-blue-300">
                      To capture what others say in a meeting, enable "Stereo Mix":
                    </p>
                    <ol className="list-decimal list-inside space-y-0.5 text-blue-700 dark:text-blue-400">
                      <li>Right-click volume icon → Sound settings → More sound settings</li>
                      <li>Go to "Recording" tab</li>
                      <li>Right-click empty area → "Show Disabled Devices"</li>
                      <li>Right-click "Stereo Mix" → Enable</li>
                      <li>Click "Refresh" above and select Stereo Mix</li>
                    </ol>
                    <hr className="border-blue-200 dark:border-blue-700" />
                    <p className="font-medium text-blue-800 dark:text-blue-300">
                      如需录制会议中别人说的话，请启用"立体声混音"：
                    </p>
                    <ol className="list-decimal list-inside space-y-0.5 text-blue-700 dark:text-blue-400">
                      <li>右键音量图标 → 声音设置 → 更多声音设置</li>
                      <li>进入"录制"选项卡</li>
                      <li>右键空白区域 → "显示已禁用的设备"</li>
                      <li>右键"立体声混音" → 启用</li>
                      <li>点击上方"刷新"按钮，选择立体声混音</li>
                    </ol>
                  </div>
                )}
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
