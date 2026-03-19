// ============================================================
// Meeting Store (Zustand)
// Manages recording state, audio levels, and meeting lifecycle
// ============================================================

import { create } from 'zustand';
import { captureManager } from '../services/audio/capture';
import { mockCaptureManager } from '../services/audio/mock-capture';

interface MeetingState {
  // ── Recording state ──
  isRecording: boolean;
  isPaused: boolean;
  recordingStartTime: number | null;
  recordingDuration: number;        // seconds
  recordingFilePath: string;

  // ── Audio state ──
  systemAudioActive: boolean;
  microphoneActive: boolean;
  currentVolume: number;            // 0-1
  useMock: boolean;                 // Using mock audio
  audioError: string | null;

  // ── Recording consent ──
  showRecordingConsent: boolean;
  consentDismissedThisSession: boolean;

  // ── Duration ticker ──
  _durationInterval: ReturnType<typeof setInterval> | null;

  // ── Actions ──
  requestStartRecording: () => void;
  confirmStartRecording: () => Promise<void>;
  cancelRecording: () => void;
  stopRecording: () => Promise<void>;
  dismissConsent: () => void;
}

/** Detect if real audio capture is likely available */
function canUseRealCapture(): boolean {
  return !!window.electronAPI?.audio?.getSources;
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  isRecording: false,
  isPaused: false,
  recordingStartTime: null,
  recordingDuration: 0,
  recordingFilePath: '',

  systemAudioActive: false,
  microphoneActive: false,
  currentVolume: 0,
  useMock: false,
  audioError: null,

  showRecordingConsent: false,
  consentDismissedThisSession: false,

  _durationInterval: null,

  /** Step 1: User clicks record → show consent dialog (unless dismissed) */
  requestStartRecording: () => {
    const { consentDismissedThisSession } = get();
    if (consentDismissedThisSession) {
      // Skip consent, start directly
      get().confirmStartRecording();
    } else {
      set({ showRecordingConsent: true });
    }
  },

  /** Step 2: User confirms consent → start capture */
  confirmStartRecording: async () => {
    set({ showRecordingConsent: false });

    const useReal = canUseRealCapture();
    const manager = useReal ? captureManager : mockCaptureManager;

    // Listen for state changes from capture manager
    const unsubscribe = manager.onChange((state) => {
      set({
        systemAudioActive: state.systemAudio ?? get().systemAudioActive,
        microphoneActive: state.microphone ?? get().microphoneActive,
        currentVolume: state.volume ?? get().currentVolume,
        recordingFilePath: state.filePath ?? get().recordingFilePath,
        audioError: state.error ?? get().audioError,
      });
    });

    try {
      await manager.start();

      const startTime = Date.now();
      const interval = setInterval(() => {
        set({ recordingDuration: Math.floor((Date.now() - startTime) / 1000) });
      }, 1000);

      set({
        isRecording: true,
        recordingStartTime: startTime,
        useMock: !useReal,
        _durationInterval: interval,
      });
    } catch (err) {
      console.error('[MeetingStore] Start recording failed:', err);
      set({
        audioError: err instanceof Error ? err.message : 'Failed to start recording / 启动录音失败',
      });
      unsubscribe();
    }
  },

  /** User cancels the consent dialog */
  cancelRecording: () => {
    set({ showRecordingConsent: false });
  },

  /** Stop recording */
  stopRecording: async () => {
    const { useMock, _durationInterval } = get();

    if (_durationInterval) {
      clearInterval(_durationInterval);
    }

    const manager = useMock ? mockCaptureManager : captureManager;
    const savedPath = await manager.stop();

    set({
      isRecording: false,
      isPaused: false,
      recordingStartTime: null,
      currentVolume: 0,
      systemAudioActive: false,
      microphoneActive: false,
      recordingFilePath: savedPath || get().recordingFilePath,
      _durationInterval: null,
    });
  },

  /** Dismiss consent for this session */
  dismissConsent: () => {
    set({ consentDismissedThisSession: true });
  },
}));
