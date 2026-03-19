// ============================================================
// App Root Component
// Flow: Legal Disclaimer → Onboarding (BYOK) → Main UI
// ============================================================

import { useEffect } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { useMeetingStore } from './stores/meeting-store';
import { initializeProviders, providerRegistry } from './services/ai-provider';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';
import SettingsModal from './components/SettingsModal';
import Header from './components/Header';
import RecordingConsent from './components/RecordingConsent';

export default function App() {
  const legalAccepted = useSettingsStore((s) => s.legalAccepted);
  const acceptLegal = useSettingsStore((s) => s.acceptLegal);
  const isFirstLaunch = useSettingsStore((s) => s.isFirstLaunch);
  const settingsLoaded = useSettingsStore((s) => s.settingsLoaded);
  const settingsModalOpen = useSettingsStore((s) => s.settingsModalOpen);
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const loadFromStore = useSettingsStore((s) => s.loadFromStore);

  const showRecordingConsent = useMeetingStore((s) => s.showRecordingConsent);
  const confirmStartRecording = useMeetingStore((s) => s.confirmStartRecording);
  const cancelRecording = useMeetingStore((s) => s.cancelRecording);
  const dismissConsent = useMeetingStore((s) => s.dismissConsent);
  const isRecording = useMeetingStore((s) => s.isRecording);
  const recordingFilePath = useMeetingStore((s) => s.recordingFilePath);

  useEffect(() => {
    initializeProviders();
    loadFromStore().then(() => {
      const state = useSettingsStore.getState();
      if (state.aiConfig.apiKeys) {
        providerRegistry.loadConfig(state.aiConfig);
      }
    });
  }, [loadFromStore]);

  // Loading
  if (!settingsLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-zinc-400 text-sm">Loading... / 加载中...</p>
      </div>
    );
  }

  // Step 1: Legal disclaimer
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
      {/* Modals */}
      {settingsModalOpen && <SettingsModal />}
      {showRecordingConsent && (
        <RecordingConsent
          onConfirm={() => {
            dismissConsent();
            confirmStartRecording();
          }}
          onCancel={cancelRecording}
        />
      )}

      {/* Header with recording controls */}
      <Header />

      {/* Divider */}
      <div className="border-t border-zinc-200 dark:border-zinc-700" />

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto">
        {isRecording ? (
          /* Recording active — show live view placeholder */
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
              <span className="w-6 h-6 rounded-full bg-red-500 animate-pulse" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">
              Recording in Progress / 录音中
            </h2>
            <p className="text-sm text-zinc-500 mb-4">
              Real-time transcription UI coming in Phase 3
            </p>
            <p className="text-xs text-zinc-400">
              实时转写界面将在 Phase 3 实现
            </p>
          </div>
        ) : recordingFilePath ? (
          /* Recording just stopped — show result */
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mb-4">
              <span className="text-2xl">✅</span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">
              Recording Saved / 录音已保存
            </h2>
            <p className="text-xs text-zinc-400 break-all max-w-xs">
              {recordingFilePath}
            </p>
          </div>
        ) : (
          /* Idle state */
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">
              Ready to Record / 准备录音
            </h2>
            <p className="text-sm text-zinc-500 mb-4">
              Click "Record" to start capturing audio
            </p>
            <p className="text-xs text-zinc-400 mb-6">
              点击"录音"开始捕获音频
            </p>

            <div className="space-y-2 text-left max-w-xs w-full">
              <StatusRow ok label="Legal disclaimer accepted / 法律声明已同意" />
              <StatusRow ok={hasAiKey}
                label={hasAiKey
                  ? `AI: ${aiConfig.defaultProvider} configured / 已配置`
                  : 'AI: Not configured / 未配置'
                }
              />
              <StatusRow ok label="STT engine selected / STT 引擎已选择" />
            </div>

            {!hasAiKey && (
              <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20
                border border-amber-200 dark:border-amber-800 text-left max-w-xs">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  AI features disabled — no API Key configured.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  AI 功能已禁用 — 未配置 API Key。
                </p>
                <button onClick={openSettingsModal}
                  className="mt-2 text-xs text-blue-600 hover:underline">
                  Configure now / 立即配置 →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusRow({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-zinc-500">
      <span className="text-sm">{ok ? '✅' : '⚠️'}</span>
      <span className={`text-xs ${!ok ? 'text-amber-600' : ''}`}>{label}</span>
    </div>
  );
}
