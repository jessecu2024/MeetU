// ============================================================
// App Root Component
// Flow: Legal Disclaimer → Onboarding (BYOK) → Main UI
// ============================================================

import { useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { useMeetingStore } from './stores/meeting-store';
import { initializeProviders, providerRegistry } from './services/ai-provider';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';
import SettingsModal from './components/SettingsModal';
import Header from './components/Header';
import TabBar, { type TabId } from './components/TabBar';
import RecordingConsent from './components/RecordingConsent';
import TranscriptView from './views/TranscriptView';

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

  const [activeTab, setActiveTab] = useState<TabId>('transcript');

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

      {/* Tab bar */}
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        aiConfigured={hasAiKey}
      />

      {/* Tab content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'transcript' && <TranscriptView />}
        {activeTab === 'translation' && (
          <PlaceholderView
            en="Real-time Translation"
            zh="实时翻译"
            phase="Phase 4"
          />
        )}
        {activeTab === 'speech' && (
          <PlaceholderView
            en="Speech Assistant"
            zh="发言助手"
            phase="Phase 4"
          />
        )}
        {activeTab === 'summary' && (
          <PlaceholderView
            en="Meeting Summary"
            zh="会议摘要"
            phase="Phase 5"
          />
        )}
      </div>

      {/* Bottom status bar */}
      {!isRecording && !hasAiKey && (
        <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-700
          bg-amber-50 dark:bg-amber-900/10">
          <div className="flex items-center justify-between">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              AI features disabled — no API Key / AI 功能未启用
            </p>
            <button onClick={openSettingsModal}
              className="text-xs text-blue-600 hover:underline">
              Configure / 配置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceholderView({ en, zh, phase }: { en: string; zh: string; phase: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6 text-center">
      <div>
        <p className="text-zinc-400 text-sm">{en}</p>
        <p className="text-zinc-400 text-xs mt-1">{zh}</p>
        <p className="text-zinc-300 text-xs mt-2">Coming in {phase}</p>
      </div>
    </div>
  );
}
