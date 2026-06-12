// ============================================================
// App Root Component
// Flow: Legal Disclaimer → Onboarding (BYOK) → Main UI
// ============================================================

import { useEffect, useState } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { useMeetingStore } from './stores/meeting-store';
import { useMentionStore } from './stores/mention-store';
import { initializeProviders, providerRegistry } from './services/ai-provider';
import { sttRegistry } from './services/stt-engine/engine-registry';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';
import SettingsModal from './components/SettingsModal';
import HistoryModal from './components/HistoryModal';
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
  const historyModalOpen = useSettingsStore((s) => s.historyModalOpen);
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

      // Auto-test configured AI provider on startup (silent, background)
      const defaultPid = state.aiConfig.defaultProvider;
      const defaultKey = state.aiConfig.apiKeys[defaultPid];
      if (defaultKey) {
        const { setAiTestResult } = useSettingsStore.getState();
        setAiTestResult(defaultPid, { status: 'testing' });
        const provider = providerRegistry.get(defaultPid);
        if (provider) {
          const t0 = Date.now();
          provider.testConnection()
            .then(r => setAiTestResult(defaultPid, r.ok
              ? { status: 'ok', latencyMs: Date.now() - t0 }
              : { status: 'error', error: r.error || 'Connection failed' }))
            .catch(e => setAiTestResult(defaultPid, {
              status: 'error', error: e instanceof Error ? e.message : 'Unknown error',
            }));
        }
      }

      // Auto-test configured STT engine on startup
      const sttKey = state.sttApiKeys[state.sttEngine];
      if (sttKey) {
        const { setSttTestResult } = useSettingsStore.getState();
        setSttTestResult({ status: 'testing' });
        const engine = sttRegistry.get(state.sttEngine);
        if (engine) {
          engine.setApiKey(sttKey);
          const t0 = Date.now();
          engine.testConnection()
            .then(r => setSttTestResult(r.ok
              ? { status: 'ok', latencyMs: Date.now() - t0 }
              : { status: 'error', error: r.error || 'Connection failed' }))
            .catch(e => setSttTestResult({
              status: 'error', error: e instanceof Error ? e.message : 'Unknown error',
            }));
        }
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
      {/* Browser-preview guard. The renderer is only fully functional
          inside the Electron window (window.electronAPI preload
          bridge): STT engines, AI proxying, settings persistence, and
          the recording file writer all ride on IPC. Opening the Vite
          URL directly in a browser silently degrades everything to
          demo behavior, which confused real users — so say it
          explicitly instead. */}
      {!window.electronAPI && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-amber-500 text-white text-[11px] text-center font-medium">
          Browser preview — STT, AI &amp; storage are unavailable here. Use the MeetU desktop window.
          / 浏览器预览模式 —— STT、AI 与存储不可用，请使用 MeetU 桌面窗口。
        </div>
      )}

      {/* Modals & Overlays */}
      {settingsModalOpen && <SettingsModal />}
      {historyModalOpen && <HistoryModal />}
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
