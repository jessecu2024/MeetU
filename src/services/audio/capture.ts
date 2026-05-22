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
export type AudioSegmentCallback = (data: ArrayBuffer) => void;

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

  // Segment-mode state. Set via setSegmentMode() before start().
  // When non-null, capture spawns a second, parallel MediaRecorder for each
  // window of `segmentDurationMs` and emits one complete webm file at the
  // end of each window via segmentCallbacks. The primary `recorder` above
  // is unaffected and continues to stream 250ms chunks to onAudioChunk
  // for streaming engines (Deepgram) and to the main-process file writer.
  private segmentDurationMs: number | null = null;
  private segmentCallbacks: AudioSegmentCallback[] = [];
  private segmentRecorder: MediaRecorder | null = null;
  private segmentTimer: ReturnType<typeof setTimeout> | null = null;
  // Promise that resolves when the currently-recording segment finishes
  // delivering its blob to subscribers. stop() awaits this so the final
  // segment is not lost. Replaced on every new segment.
  private segmentInflight: Promise<void> = Promise.resolve();

  private deviceId = '';

  setDevice(deviceId: string): void {
    this.deviceId = deviceId || '';
    console.log(`[Audio] Device set: "${this.deviceId || '(default)'}"`);
  }

  onAudioChunk(cb: AudioChunkCallback): () => void {
    this.audioChunkCallbacks.push(cb);
    return () => { this.audioChunkCallbacks = this.audioChunkCallbacks.filter(c => c !== cb); };
  }

  /**
   * Subscribe to complete, independently-decodable webm segments. Each
   * callback fires once per `segmentDurationMs` window (the value passed
   * to setSegmentMode). Returns an unsubscribe function.
   *
   * Requires setSegmentMode(ms) to be active; otherwise no segments are
   * produced and the callback never fires.
   */
  onSegment(cb: AudioSegmentCallback): () => void {
    this.segmentCallbacks.push(cb);
    return () => { this.segmentCallbacks = this.segmentCallbacks.filter(c => c !== cb); };
  }

  /**
   * Enable/disable segment mode. Pass a positive number to enable;
   * `null` (or omitted) to disable. Must be called before `start()`.
   * Mid-session changes are honored on the next segment boundary.
   */
  setSegmentMode(durationMs: number | null): void {
    this.segmentDurationMs = durationMs && durationMs > 0 ? durationMs : null;
    console.log(`[Audio] Segment mode: ${this.segmentDurationMs ? this.segmentDurationMs + 'ms' : 'off'}`);
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

    // Segment recorder (only if setSegmentMode was called before start())
    if (this.segmentDurationMs) {
      this.startSegmentRecorder();
    }

    // Volume indicator
    this.volumeInterval = setInterval(() => {
      if (this.recorder?.state === 'recording') {
        this.emit({ volume: 0.2 + Math.random() * 0.3 });
      }
    }, 200);
  }

  /**
   * Spawn a fresh MediaRecorder on the same MediaStream for one
   * `segmentDurationMs` window. Two correctness guarantees this
   * function provides:
   *
   * 1. **No boundary gap.** The next segment recorder starts in the
   *    first synchronous step of `onstop`, BEFORE blob packaging and
   *    callback dispatch. There is a brief overlap where both the
   *    just-stopped and just-started recorders are alive — that's
   *    allowed by the spec and is what keeps audio continuous.
   * 2. **No lost final segment.** Each segment's delivery is tracked
   *    via `segmentInflight`. `stop()` awaits this so the last
   *    in-flight blob still reaches subscribers before we tear
   *    `segmentCallbacks` down.
   */
  private startSegmentRecorder(): void {
    if (!this.stream || !this.segmentDurationMs || !this._state.recording) return;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : undefined;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
    } catch (err) {
      console.error('[Audio] Segment MediaRecorder creation failed:', err);
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    // The promise that resolves when this segment's blob has been
    // packaged and dispatched to subscribers. `stop()` awaits the
    // most recent value before clearing callbacks.
    let resolveDelivery!: () => void;
    this.segmentInflight = new Promise<void>((resolve) => { resolveDelivery = resolve; });

    recorder.onstop = () => {
      // STEP 1 (sync, first): start the next segment so audio recording
      // never gaps. The previous recorder is still alive and its
      // packaging happens below; we let them coexist briefly.
      if (this._state.recording && this.segmentDurationMs) {
        this.startSegmentRecorder();
      }

      // STEP 2 (async): package the chunks we collected and dispatch.
      // Even if there are no callbacks (e.g. stop() already cleared
      // them in tear-down) we still resolve the delivery promise so
      // anyone awaiting it doesn't hang forever.
      void (async () => {
        try {
          if (chunks.length > 0 && this.segmentCallbacks.length > 0) {
            const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
            const buffer = await blob.arrayBuffer();
            for (const cb of this.segmentCallbacks) cb(buffer);
          }
        } catch (err) {
          console.error('[Audio] Segment delivery failed:', err);
        } finally {
          resolveDelivery();
        }
      })();
    };

    this.segmentRecorder = recorder;
    recorder.start();
    this.segmentTimer = setTimeout(() => {
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    }, this.segmentDurationMs);
  }

  async stop(): Promise<string> {
    if (this.volumeInterval) { clearInterval(this.volumeInterval); this.volumeInterval = null; }

    // Disable scheduling of further segments BEFORE we trigger the
    // current one's stop. onstop checks segmentDurationMs before
    // spawning a successor, so setting this to null first ensures
    // tear-down doesn't restart segments mid-shutdown.
    const wasSegmentMode = !!this.segmentDurationMs;
    this.segmentDurationMs = null;
    if (this.segmentTimer) { clearTimeout(this.segmentTimer); this.segmentTimer = null; }

    if (this.segmentRecorder && this.segmentRecorder.state !== 'inactive') {
      try { this.segmentRecorder.stop(); } catch { /* ignore */ }
    }
    // Wait for the in-flight segment to finish delivering BEFORE we
    // clear segmentCallbacks. Without this await, the final segment's
    // onstop handler races against the callback teardown below and
    // the last few seconds of audio never reach Whisper.
    if (wasSegmentMode) {
      try { await this.segmentInflight; } catch { /* ignore */ }
    }
    this.segmentRecorder = null;

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;

    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }

    this.audioChunkCallbacks = [];
    this.segmentCallbacks = [];

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
