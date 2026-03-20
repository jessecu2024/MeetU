// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Captures audio via getUserMedia with user-selected device.
// Users can select "Stereo Mix" to capture system audio without
// affecting playback. No desktopCapturer — no audio stealing.
// ============================================================

export interface CaptureState {
  microphone: boolean;
  recording: boolean;
  volume: number;
  filePath: string;
  error: string | null;
  deviceName: string;
}

export type CaptureListener = (state: Partial<CaptureState>) => void;

const BUFFER_SIZE = 4096;
const SEND_INTERVAL_MS = 500;

export type AudioChunkCallback = (data: Float32Array) => void;

class AudioCaptureManager {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private chunkBuffer: Float32Array[] = [];
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];
  private deviceId = 'default';
  private deviceName = 'Default';

  /** Set which audio input device to use */
  setDevice(deviceId: string, deviceName: string): void {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    console.log(`[Audio] Device set: "${deviceName}" (${deviceId})`);
  }

  /** Register a callback to receive raw audio chunks (for STT) */
  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => {
      this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb);
    };
  }

  private _state: CaptureState = {
    microphone: false,
    recording: false,
    volume: 0,
    filePath: '',
    error: null,
    deviceName: 'Default',
  };

  get state(): CaptureState {
    return { ...this._state };
  }

  onChange(listener: CaptureListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit(partial: Partial<CaptureState>) {
    Object.assign(this._state, partial);
    for (const listener of this.listeners) {
      listener(partial);
    }
  }

  /** Start capturing audio from the selected device */
  async start(): Promise<void> {
    if (this._state.recording) return;

    console.log(`[Audio] Starting capture, device: "${this.deviceName}" (${this.deviceId})`);

    // Start WAV file recording in main process
    const filePath = await window.electronAPI?.audio.startRecording() as string;
    this.emit({ recording: true, filePath, error: null, deviceName: this.deviceName });

    // Create audio context
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Get audio from user-selected device — NO desktopCapturer
    try {
      const constraints: MediaStreamConstraints = {
        audio: this.deviceId === 'default'
          ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { deviceId: { exact: this.deviceId }, channelCount: 1 },
        video: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log(`[Audio] Stream obtained from "${this.deviceName}"`);
      this.emit({ microphone: true });
    } catch (err) {
      console.error('[Audio] getUserMedia failed:', err);
      this.emit({ microphone: false, error: `Mic access denied: ${err instanceof Error ? err.message : 'Unknown'} / 麦克风权限被拒绝` });
    }

    this.setupProcessing();
    this.sendInterval = setInterval(() => this.flushChunks(), SEND_INTERVAL_MS);
  }

  /** Stop capture */
  async stop(): Promise<string> {
    this.flushChunks();

    if (this.sendInterval) clearInterval(this.sendInterval);
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    this.sendInterval = null;
    this.volumeInterval = null;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.analyser = null;
    this.chunkBuffer = [];
    this.audioChunkCallbacks = [];

    const tempPath = await window.electronAPI?.audio.stopRecording() as string;

    this.emit({
      recording: false,
      microphone: false,
      volume: 0,
      filePath: tempPath || this._state.filePath,
    });

    return tempPath || '';
  }

  /** Set up Web Audio processing pipeline */
  private setupProcessing(): void {
    if (!this.audioContext || !this.stream) return;

    const ctx = this.audioContext;
    const source = ctx.createMediaStreamSource(this.stream);

    // Analyser for volume metering
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // ScriptProcessor to capture PCM data
    this.scriptProcessor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(data);
      this.chunkBuffer.push(copy);
      for (const cb of this.audioChunkCallbacks) {
        cb(copy);
      }
    };
    this.analyser.connect(this.scriptProcessor);
    // Must connect to destination to keep ScriptProcessor alive
    this.scriptProcessor.connect(ctx.destination);

    this.volumeInterval = setInterval(() => this.updateVolume(), 100);
    console.log('[Audio] Processing pipeline ready');
  }

  private updateVolume(): void {
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    this.emit({ volume: Math.min(1, rms * 3) });
  }

  private flushChunks(): void {
    if (this.chunkBuffer.length === 0) return;
    const totalLength = this.chunkBuffer.reduce((acc, c) => acc + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunkBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunkBuffer = [];
    window.electronAPI?.audio.appendChunk(merged.buffer);
  }
}

/** List available audio input devices */
export async function listAudioDevices(): Promise<Array<{ deviceId: string; label: string; isStereoMix: boolean }>> {
  try {
    // Request permission first so labels are available
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop());

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

/** Singleton instance */
export const captureManager = new AudioCaptureManager();
