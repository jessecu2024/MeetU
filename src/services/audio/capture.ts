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
/**
 * Callback for `pcm-stream` mode. Receives 16-kHz mono Float32 PCM
 * frames packaged as ArrayBuffer (i.e. `new Float32Array(buf)` rebuilds
 * the samples). Cadence depends on the AudioWorklet's render quantum;
 * each invocation typically carries ~10–25 ms of audio.
 */
export type PcmFrameCallback = (data: ArrayBuffer) => void;

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
  // Promises for every in-flight `ondataavailable` handler on the
  // primary recorder. The handler converts a Blob to ArrayBuffer
  // (async), fans out to all callbacks, and appends to the main-
  // process file writer; if `stop()` clears callbacks or closes the
  // file writer before the final chunk's async work finishes, we
  // silently drop the last 250ms of audio. stop() awaits this set
  // before tearing down.
  private mainChunkDeliveries = new Set<Promise<void>>();
  // Resolves when the primary recorder's `onstop` fires AND every
  // queued `ondataavailable` promise has settled. stop() awaits this
  // before clearing callbacks / closing the file writer.
  private mainRecorderDone: Promise<void> = Promise.resolve();

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
  // Set of in-flight segment-delivery promises. Each entry resolves when
  // a particular segment's blob has finished packaging and dispatching.
  // stop() awaits Promise.allSettled over this set so EVERY pending
  // segment (not just the last one) reaches subscribers before we tear
  // segmentCallbacks down. A previous design tracked only the latest
  // segment in a single `segmentInflight` field; on a boundary that
  // overwrote the prior segment's still-pending packaging promise and
  // dropped it.
  private segmentDeliveries = new Set<Promise<void>>();

  // PCM-stream mode state. Set via setPcmStreamMode() before start().
  // When enabled, capture wires an AudioContext + AudioWorklet to the
  // MediaStream, resamples to 16 kHz mono Float32, and pushes each
  // resampled frame to pcmFrameCallbacks. The primary MediaRecorder
  // above is unaffected (still emits webm/opus chunks to onAudioChunk
  // + to the file writer); the PCM stream is a parallel sink for
  // engines that require uncompressed PCM (iFlytek).
  private pcmStreamEnabled = false;
  private pcmFrameCallbacks: PcmFrameCallback[] = [];
  private pcmAudioContext: AudioContext | null = null;
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmSourceNode: MediaStreamAudioSourceNode | null = null;
  // Muted GainNode that gives the Web Audio graph a "sink" so the
  // worklet's process() actually runs. Without this connection (and
  // because routing straight to destination would feed back into the
  // mic), the worklet sits idle. See startPcmStream for details.
  private pcmMuteNode: GainNode | null = null;
  private pcmWorkletObjectUrl: string | null = null;

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

  /**
   * Enable/disable `pcm-stream` mode. Must be called before `start()`.
   * When enabled, capture attaches an AudioWorklet to the MediaStream,
   * resamples its output to 16 kHz mono Float32, and pushes each frame
   * to subscribers registered through `onPcmFrame`. Used by STT engines
   * that need raw PCM rather than webm/opus (iFlytek IAT).
   */
  setPcmStreamMode(enabled: boolean): void {
    this.pcmStreamEnabled = !!enabled;
    console.log(`[Audio] PCM-stream mode: ${this.pcmStreamEnabled ? 'on' : 'off'}`);
  }

  /**
   * Subscribe to PCM frames. Cadence depends on the AudioWorklet
   * render quantum (typically ~10–25 ms per frame at the post-
   * resample sample rate). Requires `setPcmStreamMode(true)` to be
   * active before `start()`.
   */
  onPcmFrame(cb: PcmFrameCallback): () => void {
    this.pcmFrameCallbacks.push(cb);
    return () => { this.pcmFrameCallbacks = this.pcmFrameCallbacks.filter(c => c !== cb); };
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

      // ondataavailable does async work (Blob→ArrayBuffer, IPC append).
      // We track each invocation as its own promise in
      // `mainChunkDeliveries` so `stop()` can drain them before clearing
      // callbacks. Without this, the FINAL 250ms chunk (the one fired
      // synchronously by MediaRecorder.stop()) races against teardown
      // and its bytes never reach Deepgram or the .webm file.
      this.recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const work = (async () => {
          const buffer = await event.data.arrayBuffer();
          if (!this._state.micActive) {
            this.emit({ micActive: true, error: null });
          }
          for (const cb of this.audioChunkCallbacks) cb(buffer);
          try {
            await window.electronAPI?.audio.appendChunk(buffer);
          } catch (err) {
            console.error('[Audio] appendChunk failed:', err);
          }
        })();
        this.mainChunkDeliveries.add(work);
        void work.finally(() => this.mainChunkDeliveries.delete(work));
      };

      // Resolves once `stop` event has fired AND every chunk delivery
      // promise has settled. `stop()` awaits this before tearing down.
      let resolveMainDone!: () => void;
      this.mainRecorderDone = new Promise<void>((resolve) => { resolveMainDone = resolve; });
      this.recorder.onstop = () => {
        void Promise.allSettled(Array.from(this.mainChunkDeliveries))
          .then(() => resolveMainDone());
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

    // PCM stream (only if setPcmStreamMode(true) was called before start()).
    // Awaited because the AudioWorklet's addModule is async; setup
    // failures MUST propagate out of `start()` so the caller can fall
    // back (e.g. meeting-store can swap in the mock STT engine).
    // Swallowing the error here was a previous bug: capture appeared
    // to start successfully, the STT engine thought it was active, but
    // no PCM frames ever arrived — leaving iFlytek silently dead.
    if (this.pcmStreamEnabled) {
      try {
        await this.startPcmStream();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        console.error('[Audio] PCM stream setup failed:', err);
        this.emit({ error: `PCM stream setup failed: ${msg} / PCM 流启动失败` });
        // Tear down anything we already started before the PCM failure
        // so we don't leave half-initialized recorders behind.
        try { this.recorder?.stop(); } catch { /* ignore */ }
        try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        this.recorder = null;
        this.stream = null;
        this.emit({ recording: false, micActive: false });
        throw err;
      }
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
   *    via `segmentDeliveries` (a Set of per-segment Promises).
   *    `stop()` awaits Promise.allSettled over the whole set so
   *    EVERY in-flight blob (not just the latest) reaches
   *    subscribers before we tear `segmentCallbacks` down.
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

    // The promise that resolves when THIS segment's blob has been
    // packaged and dispatched to subscribers. Tracked in a Set so
    // `stop()` can await every in-flight delivery, not just the latest.
    let resolveDelivery!: () => void;
    const delivery = new Promise<void>((resolve) => { resolveDelivery = resolve; });
    this.segmentDeliveries.add(delivery);
    void delivery.finally(() => this.segmentDeliveries.delete(delivery));

    // onstop only handles blob packaging + dispatch. The successor
    // recorder is started BEFORE this one is stopped (see the timer
    // below) so the boundary doesn't depend on the stop→onstop async
    // gap that browsers leave between MediaRecorder.stop() and the
    // event firing.
    recorder.onstop = () => {
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
      // Start the successor FIRST so the new recorder is actively
      // capturing before we tell the old one to stop. Without this
      // ordering, MediaRecorder.stop() returns synchronously but the
      // browser stops sampling immediately and the next recorder
      // doesn't start sampling until after `start()` is called from
      // onstop — a gap of tens of milliseconds where audio is lost,
      // every 5 seconds. Two MediaRecorders briefly coexist on the
      // same MediaStream, which the Web spec explicitly allows.
      if (this._state.recording && this.segmentDurationMs) {
        this.startSegmentRecorder();
      }
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
    }, this.segmentDurationMs);
  }

  /**
   * Set up a parallel PCM extraction pipeline:
   *   MediaStreamSource → AudioWorklet → resample(48k→16k) → callbacks
   *
   * The worklet emits Float32 frames at the AudioContext's native
   * sample rate (typically 48 kHz on macOS/Windows). We then linearly
   * downsample to 16 kHz mono because that's what iFlytek IAT (and
   * essentially every Chinese cloud STT) actually accepts. The
   * resample buffer accumulates fractional samples across frames so
   * we don't drift over a long session.
   */
  private async startPcmStream(): Promise<void> {
    if (!this.stream) return;

    // Lazy-import the worklet source. Stringifying + Blob URL avoids
    // any build-time configuration; the source lives in pcm-worklet.ts
    // and runs in the AudioWorkletGlobalScope thread.
    const { PCM_WORKLET_SOURCE, PCM_WORKLET_NAME } = await import('./pcm-worklet');
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' });
    this.pcmWorkletObjectUrl = URL.createObjectURL(blob);

    this.pcmAudioContext = new AudioContext();
    await this.pcmAudioContext.audioWorklet.addModule(this.pcmWorkletObjectUrl);

    this.pcmSourceNode = this.pcmAudioContext.createMediaStreamSource(this.stream);
    this.pcmWorkletNode = new AudioWorkletNode(this.pcmAudioContext, PCM_WORKLET_NAME);

    const sourceSampleRate = this.pcmAudioContext.sampleRate; // usually 48000
    const targetSampleRate = 16000;
    const ratio = sourceSampleRate / targetSampleRate;
    // Sample-accurate decimation needs a CARRY buffer across worklet
    // frames. The previous implementation read `input[srcIdx]` directly
    // and substituted 0 whenever the computed index exceeded the
    // current frame — i.e. it injected silence at every frame boundary
    // (~every 128 samples), audibly corrupting the 16k PCM stream.
    //
    // The carry-based variant below appends each new worklet frame to
    // a leftover buffer, picks output samples on the fixed `ratio`
    // grid, and saves the unconsumed tail for the next callback. The
    // global sample index advances monotonically across frames so a
    // long session does not accumulate phase error.
    let phase = 0;             // next source sample index we want to pick
    let carry = new Float32Array(0);

    this.pcmWorkletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this._state.recording || this.pcmFrameCallbacks.length === 0) return;
      const input = event.data;
      if (!input || input.length === 0) return;

      // Concatenate any leftover samples from the previous frame.
      const merged = new Float32Array(carry.length + input.length);
      merged.set(carry, 0);
      merged.set(input, carry.length);

      // How many output samples does this merged buffer cover?
      // We pick at floor(phase + i*ratio) for i = 0, 1, 2, ...
      const out: number[] = [];
      while (true) {
        const idx = Math.floor(phase);
        if (idx >= merged.length) break;
        out.push(merged[idx]);
        phase += ratio;
      }

      // Carry any samples we haven't consumed yet. The new buffer
      // starts at the largest integer index we read from; shift phase
      // accordingly so the next callback sees phase ∈ [0, 1).
      const drop = Math.floor(phase);
      if (drop < merged.length) {
        carry = merged.slice(drop);
        phase -= drop;
      } else {
        carry = new Float32Array(0);
        phase -= merged.length;
        if (phase < 0) phase = 0; // numerical safety
      }

      if (out.length === 0) return;
      const buf = new Float32Array(out).buffer;
      for (const cb of this.pcmFrameCallbacks) cb(buf);
    };

    // The Web Audio graph only runs nodes that are connected (directly
    // or transitively) to the destination. An AudioWorklet with no
    // downstream connection sits idle — its `process()` is never
    // called, no messages arrive, and iFlytek would see zero PCM
    // frames. We must connect downstream, but routing the mic output
    // straight to speakers would create a feedback loop. So we go
    // through a muted GainNode (gain=0) to give the graph a "sink"
    // without anything actually playing back.
    const muteNode = this.pcmAudioContext.createGain();
    muteNode.gain.value = 0;
    this.pcmSourceNode.connect(this.pcmWorkletNode);
    this.pcmWorkletNode.connect(muteNode);
    muteNode.connect(this.pcmAudioContext.destination);
    // Keep a reference so stop() can disconnect cleanly.
    this.pcmMuteNode = muteNode;
    console.log(`[Audio] PCM stream started (source ${sourceSampleRate} Hz → ${targetSampleRate} Hz mono)`);
  }

  /**
   * Tear down the PCM pipeline created in startPcmStream(). Safe to
   * call when PCM mode is off — every branch checks for null.
   */
  private async stopPcmStream(): Promise<void> {
    try { this.pcmSourceNode?.disconnect(); } catch { /* ignore */ }
    try { this.pcmWorkletNode?.disconnect(); } catch { /* ignore */ }
    try { this.pcmMuteNode?.disconnect(); } catch { /* ignore */ }
    if (this.pcmAudioContext) {
      try { await this.pcmAudioContext.close(); } catch { /* ignore */ }
    }
    if (this.pcmWorkletObjectUrl) {
      try { URL.revokeObjectURL(this.pcmWorkletObjectUrl); } catch { /* ignore */ }
      this.pcmWorkletObjectUrl = null;
    }
    this.pcmSourceNode = null;
    this.pcmWorkletNode = null;
    this.pcmMuteNode = null;
    this.pcmAudioContext = null;
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
    // Wait for EVERY in-flight segment delivery to finish before we
    // clear segmentCallbacks. Tracking only the latest promise (as a
    // previous design did) was wrong: on a boundary, onstop spawns a
    // new segment and immediately starts packaging the previous one,
    // and `stop()` could end up awaiting only the just-spawned (still
    // pending) recorder while the previous segment's blob delivery
    // ran to completion against a torn-down callback list.
    if (wasSegmentMode && this.segmentDeliveries.size > 0) {
      await Promise.allSettled(Array.from(this.segmentDeliveries));
    }
    this.segmentRecorder = null;

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    // Wait for the primary recorder's final `ondataavailable` (fired
    // synchronously by stop()) to finish: Blob→ArrayBuffer is async,
    // and `appendChunk` IPC is async too. Clearing audioChunkCallbacks
    // or calling `audio.stopRecording` (which closes the .webm file
    // writer) before this drain would drop the last 250ms — both from
    // Deepgram's WebSocket and from the saved recording on disk.
    try { await this.mainRecorderDone; } catch { /* ignore */ }
    this.recorder = null;

    // Tear down the PCM pipeline (no-op when PCM mode is off). Done
    // BEFORE clearing pcmFrameCallbacks below so a final worklet
    // postMessage doesn't sneak through.
    if (this.pcmStreamEnabled) {
      await this.stopPcmStream();
      this.pcmStreamEnabled = false;
    }

    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }

    this.audioChunkCallbacks = [];
    this.segmentCallbacks = [];
    this.pcmFrameCallbacks = [];

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
