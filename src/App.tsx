// ============================================================
// App Root Component
// Flow: Legal Disclaimer → Onboarding (BYOK) → Main UI
// ============================================================

import { useEffect } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { initializeProviders, providerRegistry } from './services/ai-provider';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const legalAccepted = useSettingsStore((s) => s.legalAccepted);
  const acceptLegal = useSettingsStore((s) => s.acceptLegal);
  const isFirstLaunch = useSettingsStore((s) => s.isFirstLaunch);
  const settingsLoaded = useSettingsStore((s) => s.settingsLoaded);
  const settingsModalOpen = useSettingsStore((s) => s.settingsModalOpen);
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const loadFromStore = useSettingsStore((s) => s.loadFromStore);

  useEffect(() => {
    initializeProviders();
    loadFromStore().then(() => {
      // After loading, apply API keys to providers
      const state = useSettingsStore.getState();
      if (state.aiConfig.apiKeys) {
        providerRegistry.loadConfig(state.aiConfig);
      }
    });
  }, [loadFromStore]);

  // Show loading while settings load from electron-store
  if (!settingsLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-zinc-400 text-sm">Loading... / 加载中...</p>
      </div>
    );
  }

  // Step 1: Legal disclaimer (must accept first)
  if (!legalAccepted) {
    return <LegalDisclaimer onAccept={acceptLegal} />;
  }

  // Step 2: First launch onboarding
  if (isFirstLaunch) {
    return <OnboardingWizard />;
  }

  const hasAiKey = !!aiConfig.apiKeys[aiConfig.defaultProvider];

  // Step 3: Main UI
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      {/* Settings Modal */}
      {settingsModalOpen && <SettingsModal />}

      {/* Title bar (draggable) */}
      <div className="drag-region flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-sm font-bold text-zinc-900 dark:text-white no-drag">
          AI Meeting Assistant
        </h1>
        <div className="flex items-center gap-1.5 no-drag">
          <button
            onClick={openSettingsModal}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-sm"
            title="Settings / 设置"
          >
            ⚙
          </button>
          <button
            onClick={() => window.electronAPI?.window.minimize()}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-sm"
          >
            —
          </button>
          <button
            onClick={() => window.electronAPI?.window.close()}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-600 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
            AI Meeting Assistant
          </h2>
          <p className="text-sm text-zinc-500">
            Setup complete! Main UI coming soon...
          </p>
          <p className="text-xs text-zinc-400">
            设置完成！主界面开发中...
          </p>

          <div className="space-y-2 text-sm text-left max-w-xs mx-auto">
            <StatusRow ok label="Legal disclaimer accepted / 法律声明已同意" />
            <StatusRow ok={hasAiKey}
              label={hasAiKey
                ? `AI: ${aiConfig.defaultProvider} configured / 已配置`
                : 'AI: Not configured / 未配置'
              }
            />
            <StatusRow ok label="STT engine selected / STT 引擎已选择" />
            <StatusRow pending label="Audio capture module / 音频捕获模块 (Phase 2)" />
            <StatusRow pending label="Real-time transcription UI / 实时转写界面 (Phase 3)" />
          </div>

          {!hasAiKey && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20
              border border-amber-200 dark:border-amber-800 text-left max-w-xs mx-auto">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                AI features are disabled — no API Key configured.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                AI 功能已禁用 — 未配置 API Key。
              </p>
              <button
                onClick={openSettingsModal}
                className="mt-2 text-xs text-blue-600 hover:underline">
                Configure now / 立即配置 →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusRow({ ok, pending, label }: { ok?: boolean; pending?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-zinc-500">
      <span className="text-sm">
        {pending ? '⏳' : ok ? '✅' : '⚠️'}
      </span>
      <span className={`text-xs ${!ok && !pending ? 'text-amber-600' : ''}`}>{label}</span>
    </div>
  );
}
