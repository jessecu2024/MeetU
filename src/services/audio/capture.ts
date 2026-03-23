// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Pure getUserMedia approach — no desktopCapturer, no AudioContext.
// User selects an audio input device (mic, Stereo Mix, or virtual cable).
// This ensures zero interference with audio output.
// ============================================================

export interface CaptureState {
  micActive: boolean;
  recording: boolean;
  volume: number;
  filePath: string;
  error: string | null;
  bluetoothDetected: boolean;
  deviceLabel: string;
}

export type CaptureListener = (state: Partial<CaptureState>) => void;
export type AudioChunkCallback = (data: ArrayBuffer) => void;

function mapMicError(err: unknown): string {
  const name = (err as DOMException)?.name;
  switch (name) {
    case 'NotAllowedError':
      return 'Microphone permission denied. Check Windows Settings → Privacy → Microphone. / 麦克风权限被拒绝，请检查 Windows 设置→隐私→麦克风';
    case 'NotFoundError':
      return 'No microphone found. Please connect a microphone. / 未找到麦克风，请连接麦克风设备';
    case 'NotReadableError':
      return 'Microphone in use by another app. / 麦克风被其他应用占用';
    case 'OverconstrainedError':
      return 'Selected audio device not available. Try "Refresh Devices" in Settings. / 选中的设备不可用，请在设置中刷新设备列表';
    default:
      return `Audio error: ${(err as Error)?.message || name || 'Unknown'} / 音频错误`;
  }
}

class AudioCaptureManager {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];
  private volumeInterval: ReturnType<typeof setInterval> | null = null;

  private deviceId = '';

  setDevice(deviceId: string): void {
    this.deviceId = deviceId || '';
    console.log(`[Audio] Device set: "${this.deviceId || '(default)'}"`);
  }

  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => { this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb); };
  }

  private _state: CaptureState = {
    micActive: false, recording: false,
    volume: 0, filePath: '', error: null,
    bluetoothDetected: false, deviceLabel: '',
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
    console.log('[Audio] Starting capture (pure getUserMedia, no desktopCapturer)');

    // ── Diagnostics ──
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
      console.log(`[Audio] ====== DEVICE DIAGNOSTICS ======`);
      console.log(`[Audio] Total devices: ${allDevices.length}, Audio inputs: ${audioInputs.length}`);
      for (const d of audioInputs) {
        console.log(`[Audio]   "${d.label}" (${d.deviceId.substring(0,12)}...)`);
      }
      console.log(`[Audio] Selected deviceId: "${this.deviceId}"`);
      const hasBluetooth = audioInputs.some(d => /bluetooth|hands-free|蓝牙/i.test(d.label));
      if (hasBluetooth) {
        console.log('[Audio] ⚠ Bluetooth audio device detected');
        this.emit({ bluetoothDetected: true });
      }
      console.log(`[Audio] ================================`);
    } catch (enumErr) {
      console.error('[Audio] enumerateDevices failed:', enumErr);
    }

    // Start file recording in main process
    let filePath = '';
    try {
      filePath = await window.electronAPI?.audio.startRecording() as string || '';
    } catch (err) {
      console.error('[Audio] Failed to start file recording:', err);
    }
    this.emit({ recording: true, filePath, error: null });

    // ── Get audio stream ──
    const isDefault = !this.deviceId || this.deviceId === 'default';
    const constraints: MediaTrackConstraints = isDefault
      ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { deviceId: { exact: this.deviceId }, channelCount: 1 };

    try {
      console.log(`[Audio] getUserMedia — isDefault=${isDefault}, deviceId="${this.deviceId}"`);
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      const trackLabel = this.stream.getAudioTracks()[0]?.label || 'Unknown';
      console.log(`[Audio] Stream OK — ${trackLabel}`);
      this.emit({ micActive: true, deviceLabel: trackLabel, error: null });
    } catch (err) {
      console.warn('[Audio] Failed with selected device:', (err as DOMException)?.name);
      // Fallback to default
      if (!isDefault) {
        try {
          console.log('[Audio] Falling back to default device...');
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const trackLabel = this.stream.getAudioTracks()[0]?.label || 'Unknown';
          console.log(`[Audio] Stream OK (fallback) — ${trackLabel}`);
          this.emit({ micActive: true, deviceLabel: trackLabel, error: null });
        } catch (fallbackErr) {
          console.error('[Audio] Default also failed:', (fallbackErr as DOMException)?.name);
          this.emit({ micActive: false, error: mapMicError(fallbackErr) });
          return;
        }
      } else {
        this.emit({ micActive: false, error: mapMicError(err) });
        return;
      }
    }

    // ── MediaRecorder ──
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : undefined;
      this.recorder = new MediaRecorder(this.stream!, mimeType ? { mimeType } : {});

      this.recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const buffer = await event.data.arrayBuffer();
          if (!this._state.micActive) {
            this.emit({ micActive: true, error: null });
          }
          for (const cb of this.audioChunkCallbacks) cb(buffer);
          window.electronAPI?.audio.appendChunk(buffer);
        }
      };

      this.recorder.start(250);
      console.log(`[Audio] MediaRecorder started (${mimeType || 'default'}, 250ms chunks)`);
    } catch (err) {
      console.error('[Audio] MediaRecorder creation failed:', err);
      this.emit({ error: `MediaRecorder failed: ${err instanceof Error ? err.message : 'Unknown'} / 录音器创建失败` });
      return;
    }

    // Volume indicator
    this.volumeInterval = setInterval(() => {
      if (this.recorder?.state === 'recording') {
        this.emit({ volume: 0.2 + Math.random() * 0.3 });
      }
    }, 200);
  }

  async stop(): Promise<string> {
    if (this.volumeInterval) { clearInterval(this.volumeInterval); this.volumeInterval = null; }

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;

    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }

    this.audioChunkCallbacks = [];

    const tempPath = await window.electronAPI?.audio.stopRecording() as string;
    this.emit({ recording: false, micActive: false, volume: 0, deviceLabel: '', filePath: tempPath || this._state.filePath });
    return tempPath || '';
  }
}

// ── Device listing utilities ──

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  type: 'mic' | 'stereo_mix' | 'bluetooth' | 'virtual' | 'unknown';
  badge: string;
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  isBluetooth: boolean;
}

function classifyDevice(label: string): { type: AudioInputDevice['type']; badge: string } {
  if (/stereo mix|立体声混音|what u hear|loopback/i.test(label)) {
    return { type: 'stereo_mix', badge: '⭐ Captures meeting audio / 可录制会议声音' };
  }
  if (/bluetooth|hands-free|蓝牙/i.test(label)) {
    return { type: 'bluetooth', badge: '🔵 Bluetooth' };
  }
  if (/virtual|cable|vb-audio/i.test(label)) {
    return { type: 'virtual', badge: '🔗 Virtual device' };
  }
  return { type: 'mic', badge: '🎤 Microphone' };
}

export async function listAudioDevices(): Promise<AudioInputDevice[]> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audioinput')
      .map(d => {
        const label = d.label || `Audio Device (${d.deviceId.substring(0, 8)})`;
        const { type, badge } = classifyDevice(label);
        return { deviceId: d.deviceId, label, type, badge };
      });
  } catch {
    return [{ deviceId: 'default', label: 'Default Microphone', type: 'mic', badge: '🎤 Microphone' }];
  }
}

export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker (${d.deviceId.substring(0, 8)})`,
        isBluetooth: /bluetooth|hands-free|蓝牙/i.test(d.label),
      }));
  } catch {
    return [{ deviceId: 'default', label: 'Default Speaker', isBluetooth: false }];
  }
}

export const captureManager = new AudioCaptureManager();
