// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Uses getUserMedia + MediaRecorder only.
// NO AudioContext, NO ScriptProcessorNode, NO connect().
// This ensures zero interference with system audio output.
// ============================================================

export interface CaptureState {
  micActive: boolean;
  sysActive: boolean;
  recording: boolean;
  volume: number;
  filePath: string;
  error: string | null;
}

export type CaptureListener = (state: Partial<CaptureState>) => void;

/** Callback receives raw webm/opus chunks (ArrayBuffer) */
export type AudioChunkCallback = (data: ArrayBuffer) => void;

class AudioCaptureManager {
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];
  private volumeInterval: ReturnType<typeof setInterval> | null = null;

  private micDeviceId = 'default';
  private sysDeviceId = '';

  setDevices(micId: string, sysId: string): void {
    this.micDeviceId = micId || 'default';
    this.sysDeviceId = sysId || '';
    console.log(`[Audio] Devices — mic: "${micId}", system: "${sysId || 'none'}"`);
  }

  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => { this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb); };
  }

  private _state: CaptureState = {
    micActive: false, sysActive: false, recording: false,
    volume: 0, filePath: '', error: null,
  };

  get state() { return { ...this._state }; }

  onChange(listener: CaptureListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(partial: Partial<CaptureState>) {
    Object.assign(this._state, partial);
    for (const l of this.listeners) l(partial);
  }

  async start(): Promise<void> {
    if (this._state.recording) return;
    console.log('[Audio] Starting capture (MediaRecorder, no AudioContext)');

    // Start file recording in main process
    let filePath = '';
    try {
      filePath = await window.electronAPI?.audio.startRecording() as string || '';
    } catch (err) {
      console.error('[Audio] Failed to start file recording:', err);
    }
    this.emit({ recording: true, filePath, error: null });

    // Stream 1: Microphone (with fallback to default if specific device fails)
    try {
      const micConstraints: MediaTrackConstraints = this.micDeviceId === 'default'
        ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { deviceId: { exact: this.micDeviceId }, channelCount: 1 };
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
      console.log('[Audio] Mic stream OK');
      this.emit({ micActive: true });
    } catch (err) {
      console.warn('[Audio] Mic failed with selected device, trying default:', err);
      // Fallback: try default mic if specific device failed
      if (this.micDeviceId !== 'default') {
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          console.log('[Audio] Mic stream OK (fallback to default)');
          this.emit({ micActive: true, error: null });
        } catch (fallbackErr) {
          console.warn('[Audio] Default mic also failed:', fallbackErr);
          this.emit({ micActive: false, error: 'Mic access denied / 麦克风权限被拒绝' });
        }
      } else {
        this.emit({ micActive: false, error: 'Mic access denied / 麦克风权限被拒绝' });
      }
    }

    // Stream 2: System audio (Stereo Mix) — only if configured
    if (this.sysDeviceId) {
      try {
        this.sysStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: this.sysDeviceId }, channelCount: 1 },
        });
        console.log('[Audio] System audio stream OK (Stereo Mix)');
        this.emit({ sysActive: true });
      } catch (err) {
        console.warn('[Audio] System audio device not available:', err);
        this.emit({ sysActive: false, error: `System audio device not found — check Settings / 系统音频设备未找到，请检查设置` });
      }
    }

    // Combine tracks into one stream for MediaRecorder
    const combinedStream = new MediaStream();
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) combinedStream.addTrack(track);
    }
    if (this.sysStream) {
      for (const track of this.sysStream.getAudioTracks()) combinedStream.addTrack(track);
    }

    if (combinedStream.getAudioTracks().length === 0) {
      console.error('[Audio] No audio tracks available');
      this.emit({ error: 'No audio input available / 无可用音频输入' });
      return;
    }

    // Use MediaRecorder — NO AudioContext needed
    try {
      // Try webm/opus first, fall back to any supported type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : undefined;
      this.recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});

      this.recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const buffer = await event.data.arrayBuffer();
          // Feed to STT engine
          for (const cb of this.audioChunkCallbacks) cb(buffer);
          // Feed to file recording in main process
          window.electronAPI?.audio.appendChunk(buffer);
        }
      };

      this.recorder.start(250); // produce a chunk every 250ms
      console.log(`[Audio] MediaRecorder started (${mimeType || 'default'}, 250ms chunks)`);
    } catch (err) {
      console.error('[Audio] MediaRecorder creation failed:', err);
      this.emit({ error: `MediaRecorder failed: ${err instanceof Error ? err.message : 'Unknown'} / 录音器创建失败` });
      return;
    }

    // Simple volume estimation based on data size (no AudioContext needed)
    this.volumeInterval = setInterval(() => {
      // Rough volume indicator: if recorder is active, show a pulsing indicator
      if (this.recorder?.state === 'recording') {
        const fakeVolume = 0.2 + Math.random() * 0.3;
        this.emit({ volume: fakeVolume });
      }
    }, 200);
  }

  async stop(): Promise<string> {
    if (this.volumeInterval) { clearInterval(this.volumeInterval); this.volumeInterval = null; }

    // Stop MediaRecorder
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;

    // Stop streams
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.sysStream) { this.sysStream.getTracks().forEach(t => t.stop()); this.sysStream = null; }

    this.audioChunkCallbacks = [];

    // Stop file recording in main process
    const tempPath = await window.electronAPI?.audio.stopRecording() as string;

    this.emit({ recording: false, micActive: false, sysActive: false, volume: 0, filePath: tempPath || this._state.filePath });
    return tempPath || '';
  }
}

/** List available audio input devices */
export async function listAudioDevices(): Promise<Array<{ deviceId: string; label: string; isStereoMix: boolean }>> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audioinput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone (${d.deviceId.substring(0, 8)})`,
        isStereoMix: /stereo mix|立体声混音|what u hear|loopback/i.test(d.label),
      }));
  } catch {
    return [{ deviceId: 'default', label: 'Default Microphone', isStereoMix: false }];
  }
}

export const captureManager = new AudioCaptureManager();
