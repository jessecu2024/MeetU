// ============================================================
// App Root Component
// Flow: Legal Disclaimer → Onboarding (BYOK) → Main UI
// ============================================================

import { useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { useMeetingStore } from './stores/meeting-store';
import { useMentionStore } from './stores/mention-store';
import { initializeProviders, providerRegistry } from './services/ai-provider';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';
import SettingsModal from './components/SettingsModal';
import Header from './components/Header';
import TabBar, { type TabId } from './components/TabBar';
import RecordingConsent from './components/RecordingConsent';
import MentionAlert from './components/MentionAlert';
import TranscriptView from './views/TranscriptView';
import TranslationView from './views/TranslationView';
import SpeechAssistView from './views/SpeechAssistView';
import SummaryView from './views/SummaryView';

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

  const showMentionAlert = useMentionStore((s) => s.showAlert);

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

  if (!settingsLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <p className="text-zinc-400 text-sm">Loading... / 加载中...</p>
      </div>
    );
  }

  if (!legalAccepted) {
    return <LegalDisclaimer onAccept={acceptLegal} />;
  }

  if (isFirstLaunch) {
    return <OnboardingWizard />;
  }

  const hasAiKey = !!aiConfig.apiKeys[aiConfig.defaultProvider];

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      {/* Modals & Overlays */}
      {settingsModalOpen && <SettingsModal />}
      {showRecordingConsent && (
        <RecordingConsent
          onConfirm={() => {
            dismissConsent();
            confirmStartRecording().catch((err) => {
              console.error('[App] Recording start failed:', err);
            });
          }}
          onCancel={cancelRecording}
        />
      )}
      {showMentionAlert && (
        <MentionAlert onGoToSpeech={() => setActiveTab('speech')} />
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
        {activeTab === 'translation' && <TranslationView />}
        {activeTab === 'speech' && <SpeechAssistView />}
        {activeTab === 'summary' && <SummaryView />}
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
