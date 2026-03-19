// ============================================================
// Audio Capture Manager (Renderer Process)
//
// System audio: Electron desktopCapturer (Windows)
//               ScreenCaptureKit (macOS, future)
// Microphone:   Standard getUserMedia (cross-platform)
//
// If system audio capture fails, falls back to mic-only mode.
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

  /** Start capturing audio (mic + optional system audio) */
  async start(): Promise<void> {
    if (this._state.recording) return;

    // Start WAV file recording in main process
    const filePath = await window.electronAPI?.audio.startRecording() as string;
    this.emit({ recording: true, filePath, error: null });

    // Create audio context
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // 1. Capture microphone
    await this.startMicrophone();

    // 2. Try to capture system audio (Windows only for now)
    await this.startSystemAudio();

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

    // Stop WAV file recording
    const savedPath = await window.electronAPI?.audio.stopRecording() as string;

    this.emit({
      recording: false,
      systemAudio: false,
      microphone: false,
      volume: 0,
      filePath: savedPath || this._state.filePath,
    });

    return savedPath || '';
  }

  /** Start microphone capture */
  private async startMicrophone(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.emit({ microphone: true });
    } catch (err) {
      console.warn('[Capture] Microphone access denied:', err);
      this.emit({ microphone: false, error: 'Microphone access denied / 麦克风权限被拒绝' });
    }
  }

  /** Start system audio capture via Electron desktopCapturer */
  private async startSystemAudio(): Promise<void> {
    const platform = (window.electronAPI as Record<string, unknown>)?.platform;

    if (platform === 'win32') {
      await this.startWindowsSystemAudio();
    } else if (platform === 'darwin') {
      // macOS: ScreenCaptureKit native module (Phase 2 future)
      console.log('[Capture] macOS system audio: ScreenCaptureKit not yet implemented');
      this.emit({ systemAudio: false });
    } else {
      this.emit({ systemAudio: false });
    }
  }

  /** Windows: Use desktopCapturer to capture system audio */
  private async startWindowsSystemAudio(): Promise<void> {
    try {
      // Get available screen sources from main process
      const sources = await window.electronAPI?.audio.getSources() as Array<{ id: string; name: string }>;
      if (!sources || sources.length === 0) {
        throw new Error('No desktop sources available');
      }

      // Use the first screen source (typically the entire screen)
      const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];

      // Request system audio via desktop capture
      // Chromium requires both audio and video for desktop capture
      this.systemStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
          },
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSource.id,
            maxWidth: 1,
            maxHeight: 1,
            maxFrameRate: 1,
          },
        } as unknown as MediaTrackConstraints,
      });

      // We only need audio, stop video tracks to save resources
      this.systemStream.getVideoTracks().forEach(t => t.stop());

      this.emit({ systemAudio: true });
      console.log('[Capture] Windows system audio captured successfully');
    } catch (err) {
      console.warn('[Capture] System audio capture failed:', err);
      this.emit({ systemAudio: false });
    }
  }

  /** Set up Web Audio processing pipeline */
  private setupProcessing(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;

    // Create a merger to combine mic + system audio
    const merger = ctx.createChannelMerger(2);

    // Connect microphone
    if (this.micStream) {
      const micSource = ctx.createMediaStreamSource(this.micStream);
      micSource.connect(merger, 0, 0);
    }

    // Connect system audio
    if (this.systemStream && this.systemStream.getAudioTracks().length > 0) {
      const sysSource = ctx.createMediaStreamSource(this.systemStream);
      sysSource.connect(merger, 0, 1);
    }

    // Mix to mono
    const mixGain = ctx.createGain();
    mixGain.gain.value = 1.0;
    merger.connect(mixGain);

    // Analyser for volume metering
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    mixGain.connect(this.analyser);

    // ScriptProcessor to capture PCM data
    this.scriptProcessor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunkBuffer.push(new Float32Array(data));
    };
    mixGain.connect(this.scriptProcessor);
    this.scriptProcessor.connect(ctx.destination);

    // Volume monitoring
    this.volumeInterval = setInterval(() => this.updateVolume(), 100);
  }

  /** Calculate and emit current volume level */
  private updateVolume(): void {
    if (!this.analyser) return;

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / data.length);
    const volume = Math.min(1, rms * 3); // Scale up for visibility

    this.emit({ volume });
  }

  /** Send accumulated chunks to main process */
  private flushChunks(): void {
    if (this.chunkBuffer.length === 0) return;

    // Concatenate all chunks
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
