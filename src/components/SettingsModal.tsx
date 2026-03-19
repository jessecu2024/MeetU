// ============================================================
// Settings Modal / 设置面板
// Allows users to modify AI provider, API keys, STT engine,
// user profile, and app preferences at any time.
// Bilingual: English first, Chinese second
// ============================================================

import { useState } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { providerRegistry } from '../services/ai-provider';
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

export default function SettingsModal() {
  const store = useSettingsStore();
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [editingKey, setEditingKey] = useState('');
  const [editingProvider, setEditingProvider] = useState<AIProviderId | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({});

  const handleTestConnection = async (providerId: AIProviderId) => {
    setTestStatus(prev => ({ ...prev, [providerId]: 'testing' }));
    try {
      const provider = providerRegistry.get(providerId);
      if (!provider) throw new Error('Not found');
      const result = await provider.testConnection();
      setTestStatus(prev => ({ ...prev, [providerId]: result.ok ? 'ok' : 'error' }));
    } catch {
      setTestStatus(prev => ({ ...prev, [providerId]: 'error' }));
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
                            {hasKey && (
                              <button
                                onClick={() => handleTestConnection(p.id)}
                                disabled={testStatus[p.id] === 'testing'}
                                className="text-xs px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800
                                  text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200">
                                {testStatus[p.id] === 'testing' ? '...' :
                                 testStatus[p.id] === 'ok' ? '✓' :
                                 testStatus[p.id] === 'error' ? '✗ Retry' : 'Test'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Edit Key Inline */}
                        {editingProvider === p.id && (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="password"
                              value={editingKey}
                              onChange={(e) => setEditingKey(e.target.value)}
                              placeholder="sk-..."
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
                return (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {currentEngine.nameEn} API Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={store.sttApiKeys[store.sttEngine] || ''}
                        onChange={(e) => store.setSTTApiKey(store.sttEngine, e.target.value)}
                        placeholder="Enter API Key..."
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600
                          bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
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
                    value={(store.userProfile as Record<string, string>)[key] || ''}
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
