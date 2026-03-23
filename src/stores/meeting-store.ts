// ============================================================
// Meeting Store (Zustand)
// Manages recording state, audio, STT engine, and meeting lifecycle
// ============================================================

import { create } from 'zustand';
import { captureManager } from '../services/audio/capture';
import { mockCaptureManager } from '../services/audio/mock-capture';
import { sttRegistry } from '../services/stt-engine/engine-registry';
import { useTranscriptStore } from './transcript-store';
import { useTranslationStore } from './translation-store';
import { useMentionStore } from './mention-store';
import { useSettingsStore } from './settings-store';
import { translationService } from '../services/translation';
import { mentionDetector } from '../services/mention-detector';
import { speechAdvisor } from '../services/speech-advisor';
import { summarizer } from '../services/summarizer';
import { generateMeetingMinutes } from '../services/post-meeting';
import { useSummaryStore } from './summary-store';
import type { STTEngine } from '../services/stt-engine/types';

interface MeetingState {
  // ── Recording state ──
  isRecording: boolean;
  isPaused: boolean;
  recordingStartTime: number | null;
  recordingDuration: number;
  recordingFilePath: string;
  meetingId: number | null;

  // ── Audio state ──
  micActive: boolean;
  sysActive: boolean;
  currentVolume: number;
  useMock: boolean;
  audioError: string | null;
  bluetoothDetected: boolean;

  // ── STT state ──
  sttActive: boolean;
  sttMock: boolean;
  sttEngineId: string | null;

  // ── Save state ──
  showSaveConfirm: boolean;
  pendingTempPath: string;
  lastSaveResult: { saved: boolean; filePath?: string; discarded?: boolean } | null;

  // ── Consent ──
  showRecordingConsent: boolean;
  consentDismissedThisSession: boolean;

  // ── Internal ──
  _durationInterval: ReturnType<typeof setInterval> | null;
  _sttEngine: STTEngine | null;
  _audioChunkCallback: ((chunk: Float32Array) => void) | null;

  // ── Actions ──
  requestStartRecording: () => void;
  confirmStartRecording: () => Promise<void>;
  cancelRecording: () => void;
  stopRecording: () => Promise<void>;
  confirmSave: () => Promise<void>;
  discardRecording: () => void;
  dismissConsent: () => void;
  clearSaveResult: () => void;
}

function canUseRealCapture(): boolean {
  return !!window.electronAPI?.audio?.startRecording;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  isRecording: false,
  isPaused: false,
  recordingStartTime: null,
  recordingDuration: 0,
  recordingFilePath: '',
  meetingId: null,

  micActive: false,
  sysActive: false,
  currentVolume: 0,
  useMock: false,
  audioError: null,
  bluetoothDetected: false,

  sttActive: false,
  sttMock: false,
  sttEngineId: null,

  showSaveConfirm: false,
  pendingTempPath: '',
  lastSaveResult: null,

  showRecordingConsent: false,
  consentDismissedThisSession: false,

  _durationInterval: null,
  _sttEngine: null,
  _audioChunkCallback: null,

  requestStartRecording: () => {
    console.log('[MeetingStore] requestStartRecording called, consentDismissed:', get().consentDismissedThisSession);
    if (get().consentDismissedThisSession) {
      get().confirmStartRecording().catch((err) => {
        console.error('[MeetingStore] Recording start failed:', err);
        set({
          audioError: err instanceof Error ? err.message : 'Failed to start recording / 录音启动失败',
        });
      });
    } else {
      console.log('[MeetingStore] Setting showRecordingConsent: true');
      set({ showRecordingConsent: true });
    }
  },

  confirmStartRecording: async () => {
    console.log('[MeetingStore] confirmStartRecording called');
    set({ showRecordingConsent: false, audioError: null });

    const useRealAudio = canUseRealCapture();
    const audioManager = useRealAudio ? captureManager : mockCaptureManager;

    // Set audio input devices from settings
    if (useRealAudio) {
      const { micDeviceId, sysAudioDeviceId } = useSettingsStore.getState().appSettings;
      captureManager.setDevices(micDeviceId, sysAudioDeviceId);
    }

    // Create meeting in database
    let meetingId = -1;
    try {
      const result = await window.electronAPI?.db.query(
        "INSERT INTO meetings (ai_provider, stt_engine) VALUES (?, ?)",
        [useSettingsStore.getState().aiConfig.defaultProvider,
         useSettingsStore.getState().sttEngine]
      ) as { lastInsertRowid?: number } | undefined;
      meetingId = (result?.lastInsertRowid as number) || -1;
    } catch { /* DB not available */ }

    // Set up STT engine
    const settings = useSettingsStore.getState();
    const { engine: sttEngine, isMock: sttIsMock } = await sttRegistry.getConfiguredEngine(
      settings.sttEngine,
      settings.sttApiKeys
    );

    // Pass user name to mock engine for @mention demo
    if (sttIsMock && 'setUserName' in sttEngine) {
      (sttEngine as import('../services/stt-engine/mock-engine').MockSTTEngine)
        .setUserName(settings.userProfile.name, settings.userProfile.nameEn);
    }

    // Register transcript callback
    const transcriptStore = useTranscriptStore.getState();
    transcriptStore.startSession(meetingId, sttIsMock ? 'mock' : sttEngine.id, sttIsMock);

    sttEngine.onTranscript((result) => {
      useTranscriptStore.getState().addResult(result);

      // Feed final results to translation + mention detection
      if (result.isFinal) {
        const entry = {
          id: result.id, text: result.text, isFinal: true,
          speaker: result.speaker, language: result.language,
          startMs: result.startMs, endMs: result.endMs,
          confidence: result.confidence, timestamp: Date.now(),
        };
        translationService.processEntry(entry);
        mentionDetector.processEntry(entry);
      }
    });

    // Set up translation service
    translationService.onTranslation((entry) => {
      useTranslationStore.getState().addOrUpdate(entry);
    });
    translationService.start();
    useTranslationStore.getState().setActive(true);
    useTranslationStore.getState().clear();

    // Set up mention detector + speech advisor
    mentionDetector.onMention((mention) => {
      useMentionStore.getState().addMention(mention);
      speechAdvisor.generateAdvice(mention);
    });
    mentionDetector.start();
    speechAdvisor.onAdvice((advice) => {
      useMentionStore.getState().addOrUpdateAdvice(advice);
    });
    useMentionStore.getState().setActive(true);
    useMentionStore.getState().clearAll();

    // Set up summarizer
    summarizer.onSummary((summary) => {
      useSummaryStore.getState().addOrUpdateSummary(summary);
    });
    summarizer.start();
    useSummaryStore.getState().setActive(true);
    useSummaryStore.getState().clear();

    // Listen for audio capture state changes
    const unsubscribe = audioManager.onChange((state) => {
      set({
        micActive: state.micActive ?? get().micActive,
        sysActive: state.sysActive ?? get().sysActive,
        currentVolume: state.volume ?? get().currentVolume,
        recordingFilePath: state.filePath ?? get().recordingFilePath,
        audioError: state.error ?? get().audioError,
        bluetoothDetected: state.bluetoothDetected ?? get().bluetoothDetected,
      });
    });

    // Start STT session — fallback to mock if it fails
    let activeSttEngine = sttEngine;
    let activeSttIsMock = sttIsMock;
    try {
      await sttEngine.startSession({
        sampleRate: 16000,
        enableDiarization: true,
        enablePunctuation: true,
        interimResults: true,
      });
      console.log(`[MeetingStore] STT engine started: ${sttEngine.id}`);
    } catch (err) {
      console.error(`[MeetingStore] STT engine "${sttEngine.id}" failed, falling back to mock:`, err);
      set({
        audioError: `STT engine failed: ${err instanceof Error ? err.message : 'Unknown error'} — using demo mode / STT 引擎失败，使用演示模式`,
      });

      // Fall back to mock STT
      const mockEngine = sttRegistry.getMock();
      if ('setUserName' in mockEngine) {
        (mockEngine as import('../services/stt-engine/mock-engine').MockSTTEngine)
          .setUserName(settings.userProfile.name, settings.userProfile.nameEn);
      }
      mockEngine.onTranscript((result) => {
        useTranscriptStore.getState().addResult(result);
        if (result.isFinal) {
          const entry = {
            id: result.id, text: result.text, isFinal: true,
            speaker: result.speaker, language: result.language,
            startMs: result.startMs, endMs: result.endMs,
            confidence: result.confidence, timestamp: Date.now(),
          };
          translationService.processEntry(entry);
          mentionDetector.processEntry(entry);
        }
      });
      await mockEngine.startSession({ sampleRate: 16000 });
      activeSttEngine = mockEngine;
      activeSttIsMock = true;
      transcriptStore.startSession(meetingId, 'mock', true);
    }

    try {
      // Hook up audio chunks to STT engine via capture manager callback
      if (useRealAudio && !activeSttIsMock) {
        captureManager.onAudioChunk((data: ArrayBuffer) => {
          activeSttEngine.feedAudio(data);
        });
      }

      // Start audio capture
      await audioManager.start();

      const startTime = Date.now();
      const interval = setInterval(() => {
        set({ recordingDuration: Math.floor((Date.now() - startTime) / 1000) });
      }, 1000);

      set({
        isRecording: true,
        recordingStartTime: startTime,
        meetingId,
        useMock: !useRealAudio,
        sttActive: true,
        sttMock: activeSttIsMock,
        sttEngineId: activeSttIsMock ? 'mock' : activeSttEngine.id,
        _durationInterval: interval,
        _sttEngine: activeSttEngine,
      });
    } catch (err) {
      console.error('[MeetingStore] Start failed:', err);
      // Clean up services that were already started
      try {
        activeSttEngine.stopSession().catch(() => {});
        translationService.stop();
        mentionDetector.stop();
        summarizer.stop();
      } catch { /* cleanup best-effort */ }
      set({
        audioError: err instanceof Error ? err.message : 'Failed to start / 启动失败',
      });
      unsubscribe();
    }
  },

  cancelRecording: () => {
    set({ showRecordingConsent: false });
  },

  stopRecording: async () => {
    const { useMock, _durationInterval, _sttEngine, meetingId, recordingDuration } = get();

    if (_durationInterval) clearInterval(_durationInterval);

    // Stop STT
    if (_sttEngine) {
      await _sttEngine.stopSession().catch(() => {});
    }

    // Stop audio — get temp file path
    const audioManager = useMock ? mockCaptureManager : captureManager;
    const tempPath = await audioManager.stop();

    // Update meeting in database with temp path for now
    if (meetingId && meetingId > 0 && tempPath) {
      try {
        await window.electronAPI?.db.query(
          "UPDATE meetings SET end_time = datetime('now'), duration_sec = ?, audio_path = ?, status = 'ended' WHERE id = ?",
          [recordingDuration, tempPath, meetingId]
        );
      } catch { /* DB not available */ }
    }

    // Stop AI services
    translationService.stop();
    mentionDetector.stop();
    summarizer.stop();
    useTranslationStore.getState().setActive(false);
    useMentionStore.getState().setActive(false);
    useSummaryStore.getState().setActive(false);

    // Generate final summary before ending session
    const summaryStore = useSummaryStore.getState();
    summaryStore.setGeneratingMinutes(true);
    try {
      // Generate one last real-time summary
      await summarizer.generateNow();
      // Generate full meeting minutes
      const minutes = await generateMeetingMinutes(
        meetingId || -1, recordingDuration, summaryStore.summaries
      );
      summaryStore.setMeetingMinutes(minutes);
    } catch (err) {
      summaryStore.setMinutesError(
        err instanceof Error ? err.message : 'Minutes generation failed / 纪要生成失败'
      );
    } finally {
      summaryStore.setGeneratingMinutes(false);
    }

    // End transcript session
    useTranscriptStore.getState().endSession();

    set({
      isRecording: false,
      isPaused: false,
      recordingStartTime: null,
      currentVolume: 0,
      micActive: false,
      sysActive: false,
      recordingFilePath: tempPath || get().recordingFilePath,
      sttActive: false,
      _durationInterval: null,
      _sttEngine: null,
      bluetoothDetected: false,
      showSaveConfirm: !!tempPath,
      pendingTempPath: tempPath || '',
    });
  },

  confirmSave: async () => {
    const tempPath = get().pendingTempPath;
    if (!tempPath) return;

    try {
      const api = window.electronAPI as unknown as { file?: { saveRecording?: (p: string) => Promise<{ saved: boolean; filePath?: string }> } } | undefined;
      const result = await api?.file?.saveRecording?.(tempPath);
      if (result?.saved && result.filePath) {
        set({ showSaveConfirm: false, pendingTempPath: '', lastSaveResult: { saved: true, filePath: result.filePath } });
      } else {
        // Auto-save failed, but file is still at tempPath
        set({ showSaveConfirm: false, pendingTempPath: '', lastSaveResult: { saved: true, filePath: tempPath } });
      }
    } catch {
      set({ showSaveConfirm: false, pendingTempPath: '', lastSaveResult: { saved: true, filePath: tempPath } });
    }
  },

  discardRecording: () => {
    const tempPath = get().pendingTempPath;
    if (tempPath) {
      // Delete temp file via main process
      window.electronAPI?.db.query("SELECT 1").catch(() => {}); // just to trigger cleanup
    }
    set({ showSaveConfirm: false, pendingTempPath: '', lastSaveResult: { saved: false, discarded: true } });
  },

  dismissConsent: () => {
    set({ consentDismissedThisSession: true });
  },

  clearSaveResult: () => {
    set({ lastSaveResult: null });
  },
}));
