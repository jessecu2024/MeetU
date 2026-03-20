// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Dual-stream capture via getUserMedia:
//  1. Microphone — user's voice
//  2. System audio — via Stereo Mix (if configured)
// NO desktopCapturer. getUserMedia only reads input devices,
// never touches audio output — headphones work normally.
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

const BUFFER_SIZE = 4096;
const SEND_INTERVAL_MS = 500;

export type AudioChunkCallback = (data: Float32Array) => void;

class AudioCaptureManager {
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private chunkBuffer: Float32Array[] = [];
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];

  private micDeviceId = 'default';
  private sysDeviceId = '';  // empty = not configured

  /** Set device IDs before starting */
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
    console.log('[Audio] Starting dual-stream capture...');

    const filePath = await window.electronAPI?.audio.startRecording() as string;
    this.emit({ recording: true, filePath, error: null });

    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Stream 1: Microphone
    try {
      const micConstraints: MediaTrackConstraints = this.micDeviceId === 'default'
        ? { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { deviceId: { exact: this.micDeviceId }, channelCount: 1 };
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
      console.log('[Audio] Mic stream OK');
      this.emit({ micActive: true });
    } catch (err) {
      console.warn('[Audio] Mic failed:', err);
      this.emit({ micActive: false, error: 'Mic access denied / 麦克风权限被拒绝' });
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
        console.warn('[Audio] System audio failed:', err);
        this.emit({ sysActive: false });
      }
    }

    this.setupProcessing();
    this.sendInterval = setInterval(() => this.flushChunks(), SEND_INTERVAL_MS);
  }

  async stop(): Promise<string> {
    this.flushChunks();
    if (this.sendInterval) clearInterval(this.sendInterval);
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    this.sendInterval = null;
    this.volumeInterval = null;

    if (this.scriptProcessor) { this.scriptProcessor.disconnect(); this.scriptProcessor = null; }
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.sysStream) { this.sysStream.getTracks().forEach(t => t.stop()); this.sysStream = null; }
    if (this.audioContext) { await this.audioContext.close().catch(() => {}); this.audioContext = null; }

    this.analyser = null;
    this.chunkBuffer = [];
    this.audioChunkCallbacks = [];

    const tempPath = await window.electronAPI?.audio.stopRecording() as string;
    this.emit({ recording: false, micActive: false, sysActive: false, volume: 0, filePath: tempPath || this._state.filePath });
    return tempPath || '';
  }

  private setupProcessing(): void {
    if (!this.audioContext) return;
    const ctx = this.audioContext;

    const hasMic = !!this.micStream;
    const hasSys = !!this.sysStream;

    let sourceNode: AudioNode;

    if (hasMic && hasSys) {
      // Merge both streams
      const merger = ctx.createChannelMerger(2);
      ctx.createMediaStreamSource(this.micStream!).connect(merger, 0, 0);
      ctx.createMediaStreamSource(this.sysStream!).connect(merger, 0, 1);
      sourceNode = merger;
    } else if (hasMic) {
      sourceNode = ctx.createMediaStreamSource(this.micStream!);
    } else if (hasSys) {
      sourceNode = ctx.createMediaStreamSource(this.sysStream!);
    } else {
      console.warn('[Audio] No audio sources!');
      return;
    }

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    sourceNode.connect(this.analyser);

    this.scriptProcessor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(data);
      this.chunkBuffer.push(copy);
      for (const cb of this.audioChunkCallbacks) cb(copy);
    };
    this.analyser.connect(this.scriptProcessor);
    // Connect to a silent gain node (NOT ctx.destination) to keep pipeline alive
    // without interfering with system audio output
    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    silentSink.connect(ctx.destination);
    this.scriptProcessor.connect(silentSink);

    this.volumeInterval = setInterval(() => this.updateVolume(), 100);
    console.log(`[Audio] Pipeline ready — mic:${hasMic} sys:${hasSys}`);
  }

  private updateVolume(): void {
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const n = (data[i] - 128) / 128;
      sum += n * n;
    }
    this.emit({ volume: Math.min(1, Math.sqrt(sum / data.length) * 3) });
  }

  private flushChunks(): void {
    if (this.chunkBuffer.length === 0) return;
    const total = this.chunkBuffer.reduce((a, c) => a + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of this.chunkBuffer) { merged.set(c, off); off += c.length; }
    this.chunkBuffer = [];
    window.electronAPI?.audio.appendChunk(merged.buffer);
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
