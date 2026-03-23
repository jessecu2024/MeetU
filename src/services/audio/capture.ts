// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Dual-stream architecture:
//   Stream 1: Microphone (getUserMedia)
//   Stream 2: System audio (desktopCapturer → getUserMedia)
//
// Both streams are mixed via AudioContext and fed to:
//   - MediaRecorder (for file recording)
//   - STT engine (for transcription)
// ============================================================

export type AudioCaptureMode = 'mic_and_system' | 'mic_only' | 'system_only';

export interface CaptureState {
  micActive: boolean;
  sysActive: boolean;
  recording: boolean;
  volume: number;
  filePath: string;
  error: string | null;
  bluetoothDetected: boolean;
}

export type CaptureListener = (state: Partial<CaptureState>) => void;

/** Callback receives raw webm/opus chunks (ArrayBuffer) */
export type AudioChunkCallback = (data: ArrayBuffer) => void;

/** Map getUserMedia error names to user-friendly bilingual messages */
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
      return 'Selected microphone not available. / 选中的麦克风不可用';
    default:
      return `Microphone error: ${(err as Error)?.message || name || 'Unknown'} / 麦克风错误`;
  }
}

class AudioCaptureManager {
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];
  private volumeInterval: ReturnType<typeof setInterval> | null = null;

  private micDeviceId = '';
  private captureMode: AudioCaptureMode = 'mic_and_system';

  setDevices(micId: string, _sysId: string): void {
    this.micDeviceId = micId || '';
    console.log(`[Audio] Devices — mic: "${this.micDeviceId || '(default)'}"`);
  }

  setCaptureMode(mode: AudioCaptureMode): void {
    this.captureMode = mode;
    console.log(`[Audio] Capture mode: ${mode}`);
  }

  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => { this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb); };
  }

  private _state: CaptureState = {
    micActive: false, sysActive: false, recording: false,
    volume: 0, filePath: '', error: null, bluetoothDetected: false,
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
    const wantMic = this.captureMode !== 'system_only';
    const wantSystem = this.captureMode !== 'mic_only';
    console.log(`[Audio] Starting capture — mode: ${this.captureMode}, wantMic: ${wantMic}, wantSystem: ${wantSystem}`);

    // ── Diagnostics: enumerate devices ──
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
      console.log(`[Audio] ====== DEVICE DIAGNOSTICS ======`);
      console.log(`[Audio] Total devices: ${allDevices.length}, Audio inputs: ${audioInputs.length}`);
      for (const d of audioInputs) {
        console.log(`[Audio]   deviceId="${d.deviceId.substring(0,12)}..." label="${d.label}"`);
      }
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

    // ── Step 1: Microphone stream ──
    if (wantMic) {
      try {
        // Request permission first
        const permStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        permStream.getTracks().forEach(t => t.stop());

        const isDefaultMic = !this.micDeviceId || this.micDeviceId === 'default';
        const micConstraints: MediaTrackConstraints = isDefaultMic
          ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { deviceId: { exact: this.micDeviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };

        console.log(`[Audio] Step 1: getUserMedia mic — isDefault=${isDefaultMic}`);
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
        console.log('[Audio] Mic stream OK —', this.micStream.getAudioTracks()[0]?.label);
        this.emit({ micActive: true });
      } catch (err) {
        console.warn('[Audio] Mic failed:', (err as DOMException)?.name);
        // Try default fallback
        try {
          this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          console.log('[Audio] Mic stream OK (fallback) —', this.micStream.getAudioTracks()[0]?.label);
          this.emit({ micActive: true });
        } catch (fallbackErr) {
          console.error('[Audio] Mic completely failed:', (fallbackErr as DOMException)?.name);
          this.emit({ micActive: false, error: mapMicError(fallbackErr) });
        }
      }
    }

    // ── Step 2: System audio via desktopCapturer ──
    if (wantSystem) {
      try {
        console.log('[Audio] Step 2: Requesting system audio via desktopCapturer...');
        // In Electron, desktopCapturer is accessed via getUserMedia with chromeMediaSource
        // We need to get a source ID first via the main process
        const sourceId = await window.electronAPI?.audio.getDesktopSourceId() as string;
        if (sourceId) {
          console.log(`[Audio] Got desktop source ID: ${sourceId.substring(0, 20)}...`);
          this.sysStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
              },
            } as unknown as MediaTrackConstraints,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
              },
            } as unknown as MediaTrackConstraints,
          });
          // Stop video tracks — we only need audio
          this.sysStream.getVideoTracks().forEach(t => t.stop());
          const audioTrack = this.sysStream.getAudioTracks()[0];
          if (audioTrack) {
            console.log(`[Audio] System audio stream OK — track: ${audioTrack.label}, readyState: ${audioTrack.readyState}`);
            this.emit({ sysActive: true });
          } else {
            console.warn('[Audio] desktopCapturer returned no audio tracks');
            this.emit({ sysActive: false });
          }
        } else {
          console.warn('[Audio] No desktop source available');
          this.emit({ sysActive: false });
        }
      } catch (err) {
        console.warn('[Audio] System audio capture failed:', (err as Error)?.message);
        this.emit({ sysActive: false });
        // Not fatal — continue with mic only
      }
    }

    // ── Step 3: Mix streams via AudioContext ──
    const hasMic = !!this.micStream?.getAudioTracks().length;
    const hasSys = !!this.sysStream?.getAudioTracks().length;

    if (!hasMic && !hasSys) {
      console.error('[Audio] No audio streams available');
      this.emit({ error: 'No audio input available / 无可用音频输入' });
      return;
    }

    let recordingStream: MediaStream;

    if (hasMic && hasSys) {
      // Mix both streams via AudioContext
      console.log('[Audio] Mixing mic + system audio via AudioContext');
      this.audioContext = new AudioContext();
      const destination = this.audioContext.createMediaStreamDestination();

      const micSource = this.audioContext.createMediaStreamSource(this.micStream!);
      micSource.connect(destination);

      const sysSource = this.audioContext.createMediaStreamSource(this.sysStream!);
      sysSource.connect(destination);

      recordingStream = destination.stream;
    } else if (hasMic) {
      recordingStream = this.micStream!;
    } else {
      recordingStream = this.sysStream!;
    }

    // ── Step 4: MediaRecorder on the mixed/single stream ──
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : undefined;
      this.recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : {});

      this.recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const buffer = await event.data.arrayBuffer();
          // Mark mic/sys active on first real data
          if (!this._state.micActive && hasMic) {
            this.emit({ micActive: true, error: null });
          }
          if (!this._state.sysActive && hasSys) {
            this.emit({ sysActive: true });
          }
          // Feed to STT engine
          for (const cb of this.audioChunkCallbacks) cb(buffer);
          // Feed to file recording in main process
          window.electronAPI?.audio.appendChunk(buffer);
        }
      };

      this.recorder.start(250);
      console.log(`[Audio] MediaRecorder started (${mimeType || 'default'}, 250ms chunks, sources: ${hasMic ? 'mic' : ''}${hasMic && hasSys ? '+' : ''}${hasSys ? 'system' : ''})`);
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

    // Close AudioContext if used for mixing
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch { /* ignore */ }
      this.audioContext = null;
    }

    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.sysStream) { this.sysStream.getTracks().forEach(t => t.stop()); this.sysStream = null; }

    this.audioChunkCallbacks = [];

    const tempPath = await window.electronAPI?.audio.stopRecording() as string;

    this.emit({ recording: false, micActive: false, sysActive: false, volume: 0, filePath: tempPath || this._state.filePath });
    return tempPath || '';
  }
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  isStereoMix: boolean;
  isBluetooth: boolean;
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  isBluetooth: boolean;
}

/** List available audio input devices */
export async function listAudioDevices(): Promise<AudioInputDevice[]> {
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
        isBluetooth: /bluetooth|hands-free|蓝牙/i.test(d.label),
      }));
  } catch {
    return [{ deviceId: 'default', label: 'Default Microphone', isStereoMix: false, isBluetooth: false }];
  }
}

/** List available audio output devices */
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
