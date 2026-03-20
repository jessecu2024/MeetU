// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Captures microphone audio for STT and recording.
// System audio capture is optional (off by default).
// ============================================================

export interface CaptureState {
  systemAudio: boolean;
  microphone: boolean;
  recording: boolean;
  volume: number;        // 0-1 RMS volume level
  filePath: string;
  error: string | null;
}

export type CaptureListener = (state: Partial<CaptureState>) => void;

const BUFFER_SIZE = 4096;
const SEND_INTERVAL_MS = 500; // Send chunks to main process every 500ms

export type AudioChunkCallback = (data: Float32Array) => void;

export type AudioMode = 'mic_only' | 'mic_and_system';

class AudioCaptureManager {
  private micStream: MediaStream | null = null;
  private systemStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private chunkBuffer: Float32Array[] = [];
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: CaptureListener[] = [];
  private audioChunkCallbacks: AudioChunkCallback[] = [];
  private audioMode: AudioMode = 'mic_only';

  /** Set audio capture mode */
  setAudioMode(mode: AudioMode): void {
    this.audioMode = mode;
    console.log(`[Audio] Audio mode set to: ${mode}`);
  }

  /** Register a callback to receive raw audio chunks (for STT) */
  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => {
      this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb);
    };
  }

  private _state: CaptureState = {
    systemAudio: false,
    microphone: false,
    recording: false,
    volume: 0,
    filePath: '',
    error: null,
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

  /** Start capturing audio */
  async start(): Promise<void> {
    if (this._state.recording) return;

    console.log(`[Audio] Starting capture, mode: ${this.audioMode}`);

    // Start WAV file recording in main process
    const filePath = await window.electronAPI?.audio.startRecording() as string;
    this.emit({ recording: true, filePath, error: null });

    // Create audio context
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // 1. Capture microphone only — no desktopCapturer, no system audio stealing
    console.log('[Audio] Requesting microphone via getUserMedia...');
    await this.startMicrophone();

    // 2. Only capture system audio if explicitly requested
    if (this.audioMode === 'mic_and_system') {
      console.log('[Audio] Also capturing system audio (user opted in)');
      await this.startSystemAudio();
    } else {
      console.log('[Audio] Mic-only mode — NOT calling desktopCapturer');
      this.emit({ systemAudio: false });
    }

    // Set up audio processing pipeline
    this.setupProcessing();

    // Periodic chunk sending to main process
    this.sendInterval = setInterval(() => this.flushChunks(), SEND_INTERVAL_MS);
  }

  /** Stop all audio capture */
  async stop(): Promise<string> {
    // Flush remaining chunks
    this.flushChunks();

    // Stop processing
    if (this.sendInterval) clearInterval(this.sendInterval);
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    this.sendInterval = null;
    this.volumeInterval = null;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    // Stop microphone
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    // Stop system audio
    if (this.systemStream) {
      this.systemStream.getTracks().forEach(t => t.stop());
      this.systemStream = null;
    }

    // Close audio context
    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.analyser = null;
    this.chunkBuffer = [];
    this.audioChunkCallbacks = [];

    // Stop WAV file recording — returns temp path
    const tempPath = await window.electronAPI?.audio.stopRecording() as string;

    this.emit({
      recording: false,
      systemAudio: false,
      microphone: false,
      volume: 0,
      filePath: tempPath || this._state.filePath,
    });

    return tempPath || '';
  }

  /** Start microphone capture — standard getUserMedia, no desktopCapturer */
  private async startMicrophone(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('[Audio] Microphone stream obtained successfully');
      this.emit({ microphone: true });
    } catch (err) {
      console.warn('[Audio] Microphone access denied:', err);
      this.emit({ microphone: false, error: 'Microphone access denied / 麦克风权限被拒绝' });
    }
  }

  /** Start system audio capture via Electron desktopCapturer (opt-in only) */
  private async startSystemAudio(): Promise<void> {
    const platform = (window.electronAPI as Record<string, unknown>)?.platform;
    if (platform !== 'win32') {
      this.emit({ systemAudio: false });
      return;
    }

    try {
      const sources = await window.electronAPI?.audio.getSources() as Array<{ id: string; name: string }>;
      if (!sources || sources.length === 0) throw new Error('No desktop sources');

      const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];

      this.systemStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: 'desktop' },
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSource.id,
            maxWidth: 1, maxHeight: 1, maxFrameRate: 1,
          },
        } as unknown as MediaTrackConstraints,
      });

      this.systemStream.getVideoTracks().forEach(t => t.stop());
      this.emit({ systemAudio: true });
      console.log('[Audio] System audio captured');
    } catch (err) {
      console.warn('[Audio] System audio capture failed:', err);
      this.emit({ systemAudio: false });
    }
  }

  /** Set up Web Audio processing pipeline */
  private setupProcessing(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;

    // Connect mic source directly (no merger needed in mic-only mode)
    let sourceNode: AudioNode;

    if (this.micStream && this.systemStream && this.systemStream.getAudioTracks().length > 0) {
      // Merge mic + system audio
      const merger = ctx.createChannelMerger(2);
      const micSource = ctx.createMediaStreamSource(this.micStream);
      micSource.connect(merger, 0, 0);
      const sysSource = ctx.createMediaStreamSource(this.systemStream);
      sysSource.connect(merger, 0, 1);
      sourceNode = merger;
    } else if (this.micStream) {
      sourceNode = ctx.createMediaStreamSource(this.micStream);
    } else {
      console.warn('[Audio] No audio source available');
      return;
    }

    // Gain node
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    sourceNode.connect(gain);

    // Analyser for volume metering
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    gain.connect(this.analyser);

    // ScriptProcessor to capture PCM data
    this.scriptProcessor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(data);
      this.chunkBuffer.push(copy);
      // Feed audio to STT engines
      for (const cb of this.audioChunkCallbacks) {
        cb(copy);
      }
    };
    gain.connect(this.scriptProcessor);
    // Connect to destination to keep the pipeline alive, but output is silent
    // since we're only processing input, not playing back
    this.scriptProcessor.connect(ctx.destination);

    // Volume monitoring
    this.volumeInterval = setInterval(() => this.updateVolume(), 100);

    console.log('[Audio] Processing pipeline set up');
  }

  /** Calculate and emit current volume level */
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
    const volume = Math.min(1, rms * 3);

    this.emit({ volume });
  }

  /** Send accumulated chunks to main process */
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

    // Send to main process for WAV file writing
    window.electronAPI?.audio.appendChunk(merged.buffer);
  }
}

/** Singleton instance */
export const captureManager = new AudioCaptureManager();
