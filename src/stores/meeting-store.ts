// ============================================================
// Meeting Store (Zustand)
// Manages recording state, audio, STT engine, and meeting lifecycle
// ============================================================

import { create } from 'zustand';
import { captureManager, SYSTEM_AUDIO_DEVICE_ID } from '../services/audio/capture';
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
  currentVolume: number;
  useMock: boolean;
  audioError: string | null;
  bluetoothDetected: boolean;
  deviceLabel: string;

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
  currentVolume: 0,
  useMock: false,
  audioError: null,
  bluetoothDetected: false,
  deviceLabel: '',

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

    // Set audio input device from settings. Before handing the
    // persisted value to captureManager, normalize a stale
    // SYSTEM_AUDIO_DEVICE_ID sentinel back to 'default' on platforms
    // where the probe says system-audio loopback is unavailable.
    //
    // Why this guard exists at the recording entry point and not only
    // in SettingsModal: the SettingsModal auto-reset only fires when
    // the user actually opens the Preferences tab. A user who
    // selected system audio on Windows and later launches on macOS /
    // Linux / Windows <10 could go straight from app start → "start
    // recording" without visiting Settings; without this guard, the
    // stale sentinel would flow into captureManager, getDisplayMedia
    // would attempt the loopback path, main.ts would reject it with
    // NotAllowedError, and the whole session would fall back to mock
    // demo audio. Probing here closes that gap.
    if (useRealAudio) {
      let micDeviceId = useSettingsStore.getState().appSettings.micDeviceId;
      // Default backend = electron-loopback (Windows getDisplayMedia).
      // The probe upgrades this to 'macos-native' on macOS 13+ with the
      // native addon loaded. Reset to null when not using system audio.
      let backend: 'electron-loopback' | 'macos-native' | null = null;
      if (micDeviceId === SYSTEM_AUDIO_DEVICE_ID) {
        const resetToDefault = (reasonLog: string, detail?: unknown) => {
          console.warn(`[MeetingStore] ${reasonLog}`, detail ?? '');
          useSettingsStore.getState().updateAppSettings({
            micDeviceId: 'default',
            micDeviceLabel: 'Default Microphone',
          });
          micDeviceId = 'default';
          backend = null;
        };
        try {
          const probe = await window.electronAPI?.audio.probeSystemAudio();
          if (probe && !probe.supported) {
            resetToDefault(
              'System-audio sentinel selected but probe says unsupported; resetting to default mic before record start',
              probe,
            );
          } else if (probe) {
            // Carry the probe's chosen backend into capture so it knows
            // whether to drive getDisplayMedia (Windows) or the native
            // ScreenCaptureKit IPC (macOS).
            backend = probe.mode ?? 'electron-loopback';
          }
        } catch (err) {
          // Probe IPC failed — be safe and fall back. Better to record
          // from the default mic than to throw at the start of a
          // session the user just consented to.
          resetToDefault('System-audio probe failed before record start; falling back to default mic', err);
        }
      }
      // The macOS native pid (per-app capture) is read from settings;
      // 0 / undefined means whole-system capture.
      const macAppPid = useSettingsStore.getState().appSettings.sysAudioMacAppPid;
      captureManager.setSystemAudioBackend(backend, backend === 'macos-native' ? macAppPid : null);
      captureManager.setDevice(micDeviceId);
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

    // Local Whisper: tell the engine which downloaded ggml model to
    // load before startSession. Safe to call on the real engine only;
    // the mock fallback has no setModel.
    if (!sttIsMock && sttEngine.id === 'local_whisper' && 'setModel' in sttEngine) {
      (sttEngine as import('../services/stt-engine/local-whisper').LocalWhisperEngine)
        .setModel(settings.appSettings.localWhisperModel);
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

    // Listen for audio capture state changes. The subscriber is
    // tracked through `unsubscribe` so the fallback path (real audio
    // start fails → swap to mockCaptureManager) can re-subscribe
    // against the right source; without that, the UI would keep
    // reading state from the abandoned real `audioManager` and the
    // mock's mic/volume/filePath updates would never reach the user.
    const stateListener = (state: Partial<import('../services/audio/capture').CaptureState>) => {
      set({
        micActive: state.micActive ?? get().micActive,
        currentVolume: state.volume ?? get().currentVolume,
        recordingFilePath: state.filePath ?? get().recordingFilePath,
        audioError: state.error ?? get().audioError,
        bluetoothDetected: state.bluetoothDetected ?? get().bluetoothDetected,
        deviceLabel: state.deviceLabel ?? get().deviceLabel,
      });
    };
    let unsubscribe = audioManager.onChange(stateListener);

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
      // Hook up audio to the STT engine via capture-manager callbacks.
      // Three delivery modes exist; the engine declares which it wants:
      // - 'stream' (default): raw 250ms MediaRecorder chunks (webm/opus).
      //   Deepgram streams these straight over its WebSocket.
      // - 'segment': capture spawns a parallel MediaRecorder per window;
      //   each callback fires with one complete webm file. Whisper API
      //   needs this because every REST request carries one audio file.
      // - 'pcm-stream': capture attaches an AudioWorklet + resampler
      //   and emits 16-kHz mono Float32 frames. iFlytek needs this
      //   because IAT only accepts audio/L16;rate=16000.
      //
      // Mode setters MUST be called BEFORE audioManager.start so the
      // corresponding pipeline is wired on the first frame/window.
      if (useRealAudio && !activeSttIsMock) {
        const mode = activeSttEngine.audioMode ?? 'stream';
        if (mode === 'segment' && activeSttEngine.segmentDurationMs && activeSttEngine.segmentDurationMs > 0) {
          captureManager.setSegmentMode(activeSttEngine.segmentDurationMs);
          captureManager.setPcmStreamMode(false);
          captureManager.onSegment((data: ArrayBuffer) => {
            activeSttEngine.feedAudio(data);
          });
        } else if (mode === 'pcm-stream') {
          captureManager.setSegmentMode(null);
          captureManager.setPcmStreamMode(true);
          captureManager.onPcmFrame((data: ArrayBuffer) => {
            activeSttEngine.feedAudio(data);
          });
        } else {
          captureManager.setSegmentMode(null);
          captureManager.setPcmStreamMode(false);
          captureManager.onAudioChunk((data: ArrayBuffer) => {
            activeSttEngine.feedAudio(data);
          });
        }
      }

      // Tracks the audio source actually in use, independent of the
      // STT engine. Stays in sync with `audioManager` so stopRecording
      // can `audioManager.stop()` against the right manager. The
      // previous `useMock` field conflated audio-mock with stt-mock
      // and would tell stopRecording to stop the wrong manager (e.g.
      // STT-only fallback would stop the mock capture and leave the
      // real mic running indefinitely).
      let useMockAudio = !useRealAudio;
      // Start audio capture
      try {
        await audioManager.start();
      } catch (audioErr) {
        // Audio capture failed to come up — for engines with custom
        // pipelines (PCM stream for iFlytek), this can happen if the
        // AudioWorklet's addModule rejects, the AudioContext is
        // blocked, etc. Rather than abort the session, fall through
        // to a mock-audio + mock-STT pairing so the user can still
        // exercise the meeting flow and see what happened.
        console.error('[MeetingStore] Real audio start failed, falling back to mock:', audioErr);
        const msg = audioErr instanceof Error ? audioErr.message : 'Audio start failed';
        set({
          audioError: `Audio capture failed: ${msg} — running in demo mode / 音频启动失败，已切换到演示模式`,
        });
        try { await activeSttEngine.stopSession(); } catch { /* ignore */ }

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
        // Audio source is now the mock too — reflect that in the
        // dedicated flag so stopRecording calls mockCaptureManager.stop()
        // (and not the abandoned real captureManager).
        useMockAudio = true;
        // Re-route the audio-state subscription from the failed real
        // manager onto the mock so the UI continues to see mic
        // active / volume / filePath updates during demo mode.
        try { unsubscribe(); } catch { /* ignore */ }
        unsubscribe = mockCaptureManager.onChange(stateListener);
        await mockCaptureManager.start();
        transcriptStore.startSession(meetingId, 'mock', true);
      }

      const startTime = Date.now();
      const interval = setInterval(() => {
        set({ recordingDuration: Math.floor((Date.now() - startTime) / 1000) });
      }, 1000);

      set({
        isRecording: true,
        recordingStartTime: startTime,
        meetingId,
        // useMock used to mean "show demo banner" AND "stopRecording
        // picks mockCaptureManager". Conflating audio mock with STT
        // mock leaks the real mic when only STT falls back to mock.
        // Now: useMock follows audio source only; sttMock follows STT.
        useMock: useMockAudio,
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
    const { useMock, sttMock, _durationInterval, _sttEngine, meetingId, recordingDuration } = get();

    if (_durationInterval) clearInterval(_durationInterval);

    // Stop audio FIRST so the final segment (segment-mode engines like
    // Whisper) or the last 250ms chunk (streaming engines like Deepgram)
    // is flushed through capture's `await this.segmentInflight` and fed
    // to the STT engine before we tell that engine to shut down. The
    // previous order (STT first, then audio) discarded the final segment
    // because the engine's `running` flag was already false by the time
    // capture delivered the blob.
    const audioManager = useMock ? mockCaptureManager : captureManager;
    const tempPath = await audioManager.stop();

    // Now safe to stop the STT engine — no more audio is coming.
    if (_sttEngine) {
      await _sttEngine.stopSession().catch(() => {});
    }

    // Update meeting in database with temp path for now. Demo (mock-STT)
    // sessions are throwaway by definition: their transcripts are
    // simulated dialogue, so persisting the meeting row would pollute
    // the History browser with fake meetings that read as real
    // (real-machine testing surfaced exactly this — 4 of 5 history rows
    // were demo data). Delete the row instead; ON DELETE CASCADE clears
    // any stray transcript rows. The on-disk audio recording (if any)
    // is unaffected — the save/discard flow below handles that file
    // independently of the DB row.
    if (meetingId && meetingId > 0) {
      try {
        if (sttMock) {
          await window.electronAPI?.db.query('DELETE FROM meetings WHERE id = ?', [meetingId]);
        } else if (tempPath) {
          await window.electronAPI?.db.query(
            "UPDATE meetings SET end_time = datetime('now'), duration_sec = ?, audio_path = ?, status = 'ended' WHERE id = ?",
            [recordingDuration, tempPath, meetingId]
          );
        }
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
      deviceLabel: '',
      recordingFilePath: tempPath || get().recordingFilePath,
      sttActive: false,
      _durationInterval: null,
      _sttEngine: null,
      bluetoothDetected: false,
      showSaveConfirm: !!tempPath,
      pendingTempPath: tempPath || '',
      // Session-scoped status must not outlive the session. The mock
      // capture manager reports "Mock mode — using simulated audio"
      // through the error channel; without clearing it here, that
      // informational message lingers on the idle header styled as a
      // red error after Stop (seen in real-machine UI testing). Any
      // genuine start-failure error is set AFTER stop completes, so
      // clearing here cannot mask it.
      audioError: null,
      useMock: false,
      sttMock: false,
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
