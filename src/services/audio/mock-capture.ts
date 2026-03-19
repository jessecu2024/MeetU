// ============================================================
// Mock Audio Capture Manager
// Generates simulated audio data for development/testing.
// Used when real audio capture is unavailable or for UI testing.
// ============================================================

import type { CaptureState, CaptureListener } from './capture';

class MockCaptureManager {
  private _state: CaptureState = {
    systemAudio: false,
    microphone: false,
    recording: false,
    volume: 0,
    filePath: '',
    error: null,
  };
  private listeners: CaptureListener[] = [];
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private chunkInterval: ReturnType<typeof setInterval> | null = null;

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

  /** Start mock capture */
  async start(): Promise<void> {
    if (this._state.recording) return;

    // Start real WAV file if electron API available
    let filePath = 'mock_recording.wav';
    try {
      filePath = await window.electronAPI?.audio.startRecording() as string || filePath;
    } catch { /* mock mode */ }

    this.emit({
      recording: true,
      microphone: true,
      systemAudio: false,
      filePath,
      error: 'Mock mode — using simulated audio / 模拟模式 — 使用模拟音频数据',
    });

    // Simulate volume fluctuations
    this.volumeInterval = setInterval(() => {
      const volume = 0.1 + Math.random() * 0.4 + Math.sin(Date.now() / 500) * 0.15;
      this.emit({ volume: Math.max(0, Math.min(1, volume)) });
    }, 100);

    // Generate mock audio chunks (sine wave at 440Hz)
    this.chunkInterval = setInterval(() => {
      this.generateMockChunk();
    }, 500);
  }

  /** Stop mock capture */
  async stop(): Promise<string> {
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    if (this.chunkInterval) clearInterval(this.chunkInterval);
    this.volumeInterval = null;
    this.chunkInterval = null;

    let savedPath = '';
    try {
      savedPath = await window.electronAPI?.audio.stopRecording() as string || '';
    } catch { /* mock mode */ }

    this.emit({
      recording: false,
      microphone: false,
      systemAudio: false,
      volume: 0,
    });

    return savedPath;
  }

  /** Generate a sine wave chunk for testing */
  private generateMockChunk(): void {
    const sampleRate = 16000;
    const duration = 0.5; // 500ms
    const samples = sampleRate * duration;
    const data = new Float32Array(samples);
    const freq = 440;

    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3;
    }

    // Send to main process
    try {
      window.electronAPI?.audio.appendChunk(data.buffer);
    } catch { /* mock mode */ }
  }
}

export const mockCaptureManager = new MockCaptureManager();
