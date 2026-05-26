// ============================================================
// Audio Capture Manager (Renderer Process)
//
// Two acquisition paths:
//
//   1. getUserMedia — selects a specific audio input device by id.
//      Used for microphones, Bluetooth headsets, Windows Stereo Mix,
//      or any virtual audio cable the user has installed.
//
//   2. getDisplayMedia + audio:'loopback' — captures the system
//      output bus. Per Electron 30's typedef, audio:'loopback' is
//      "currently only supported on Windows" (it wraps WASAPI
//      loopback). macOS native system-audio capture (via
//      ScreenCaptureKit) is on the roadmap (PR #4b) and ships via
//      a native N-API module rather than this Electron path. The
//      main-process setDisplayMediaRequestHandler in
//      electron/main.ts enforces win32 + main-frame + audio-only
//      to keep the screen from leaking on platforms / requesters
//      where this path doesn't apply. Triggered by setting
//      `deviceId` to the sentinel SYSTEM_AUDIO_DEVICE_ID.
//
// The rest of the pipeline (MediaRecorder, segment recorder, PCM
// resampler) is identical for both paths because both yield a normal
// MediaStream with an audio track.
// ============================================================

/**
 * Sentinel `deviceId` value that tells the capture manager to use
 * `getDisplayMedia({audio:'loopback'})` instead of `getUserMedia`.
 * Anything else (including the empty string and `'default'`) is
 * treated as a normal audio input device id.
 */
export const SYSTEM_AUDIO_DEVICE_ID = '__system_audio__';

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

/**
 * Translate `getDisplayMedia` failures into actionable strings.
 * Distinct from `mapMicError` because the failure modes are different
 * (Screen Recording permission, no source available, user cancelled
 * the picker if Electron's system picker is ever turned on).
 *
 * Exported for unit testing — each branch maps a DOMException name to
 * a user-facing message; getting one of these wrong is a silent UX
 * regression that's hard to catch any other way.
 */
export function mapSystemAudioError(err: unknown): string {
  const name = (err as DOMException)?.name;
  const message = (err as Error)?.message || '';
  switch (name) {
    case 'NotAllowedError':
      // Permission denied at the OS / Electron layer. This branch is
      // the getDisplayMedia (Windows electron-loopback) path only —
      // macOS uses the native ScreenCaptureKit module whose errors
      // arrive via the IPC onError channel, not here. On Windows this
      // is rare (loopback doesn't normally prompt); it usually
      // indicates a session/permission policy bug.
      return 'System audio access denied at the OS / session layer (Windows loopback path). Please report the OS and how MeetU was launched. / 系统音频权限在 OS / 会话层被拒绝(Windows loopback 路径),请反馈系统信息与启动方式';
    case 'NotFoundError':
      return 'No system audio source available. Make sure something is playing through the system output. / 未找到系统音频源';
    case 'NotReadableError':
      // Hardware/OS-level acquisition failure (the platform admitted
      // the request but couldn't open the capture device — e.g. the
      // audio engine is in an unexpected state, another process has a
      // conflicting lock, or ScreenCaptureKit refused mid-handshake).
      return 'System audio device is busy or unreadable. Quit any other screen-recording app (Loom, OBS, QuickTime) and try again. / 系统音频设备繁忙或不可读，请退出其它录屏/录音软件后重试';
    case 'InvalidStateError':
      // Most commonly fired when getDisplayMedia is called while the
      // page is not the focused/active document or while a previous
      // capture is still tearing down. Surface a concrete action.
      return 'System audio cannot start in the current window state. Bring MeetU to the foreground and try again. / 当前窗口状态无法启动系统音频，请将 MeetU 切到前台后重试';
    case 'OverconstrainedError':
      // Our video constraints are intentionally minimal (1×1 @ 1fps)
      // but a future change might trip this. Tell the user it's an
      // app bug, not a permission/hardware problem.
      return 'System audio constraints could not be satisfied by this OS. This is likely a MeetU bug — please report it. / 系统音频约束无法满足，可能是应用 bug，请反馈';
    case 'SecurityError':
      // Browser/origin-level block: e.g. an insecure context, an iframe
      // without `allow="display-capture"`, or a Permissions-Policy
      // header forbidding the call. In a packaged Electron app this is
      // unusual but possible if the renderer is ever embedded in a
      // sandboxed frame; we surface the generic class so users can
      // report it without us mis-blaming the main process. (A missing
      // setDisplayMediaRequestHandler rejects with NotSupportedError,
      // not SecurityError — that case is handled above.)
      return 'System audio is blocked by the browser security policy (origin, iframe, or Permissions-Policy). Please report the OS and how MeetU was launched. / 系统音频被浏览器安全策略阻止，请反馈系统信息与启动方式';
    case 'TypeError':
      // Wrong argument shape — should never happen with our
      // hard-coded constraints, but DOM specs raise this when
      // getDisplayMedia is called without any constraints at all.
      return 'System audio call rejected by the browser (bad constraints). This is likely a MeetU bug — please report it. / 系统音频调用参数被浏览器拒绝，可能是应用 bug，请反馈';
    case 'NotSupportedError':
      // getDisplayMedia loopback path is Windows-only. macOS has its
      // own native ScreenCaptureKit backend (selected by the probe as
      // mode:'macos-native'), so a macOS user should never reach this
      // string — if they do, the backend was mis-selected.
      return 'System audio capture via the Electron loopback path is supported on Windows 10+ only. macOS uses the native ScreenCaptureKit backend instead. / 此 Electron loopback 路径仅 Windows 10+ 支持;macOS 使用原生 ScreenCaptureKit 后端';
    case 'AbortError':
      return 'System audio request was rejected by the main process (no screen sources). / 主进程未返回有效的屏幕源';
    default:
      return `System audio error: ${message || name || 'Unknown'} / 系统音频错误`;
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

  // macOS native ScreenCaptureKit source state. When the selected
  // device is SYSTEM_AUDIO_DEVICE_ID AND the probe reported
  // mode==='macos-native', start() takes the native path: it asks the
  // main process to start ScreenCaptureKit, receives 16-kHz mono
  // Float32 PCM frames over IPC, and replays them through a playback
  // AudioWorklet into a MediaStreamAudioDestinationNode. The
  // destination's `.stream` then feeds the normal MediaRecorder /
  // segment / resampler pipeline, so every STT engine and file
  // recording works identically to the getUserMedia/getDisplayMedia
  // paths.
  private systemAudioBackend: 'electron-loopback' | 'macos-native' | null = null;
  private systemAudioPid: number | null = null;
  private nativePlaybackCtx: AudioContext | null = null;
  private nativePlaybackNode: AudioWorkletNode | null = null;
  private nativePlaybackUrl: string | null = null;
  private nativePcmUnsub: (() => void) | null = null;
  private nativeErrorUnsub: (() => void) | null = null;
  private nativeActive = false;

  private deviceId = '';

  setDevice(deviceId: string): void {
    this.deviceId = deviceId || '';
    console.log(`[Audio] Device set: "${this.deviceId || '(default)'}"`);
  }

  /**
   * Choose which system-audio backend `start()` uses when the device
   * is SYSTEM_AUDIO_DEVICE_ID. Driven by the renderer from the
   * `system-audio:probe` result:
   *   - 'electron-loopback' (Windows) -> getDisplayMedia path
   *   - 'macos-native'      (macOS)   -> native ScreenCaptureKit IPC
   *   - null                          -> default to getDisplayMedia
   * `pid` is only honored on the macOS native path: a positive pid
   * captures that one application; null/0 captures the full system mix.
   */
  setSystemAudioBackend(mode: 'electron-loopback' | 'macos-native' | null, pid?: number | null): void {
    this.systemAudioBackend = mode;
    this.systemAudioPid = pid && pid > 0 ? pid : null;
    console.log(`[Audio] System-audio backend: ${mode ?? '(default)'}${this.systemAudioPid ? ` pid=${this.systemAudioPid}` : ''}`);
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

  /**
   * Drop every chunk/segment/PCM subscriber registered via
   * onAudioChunk / onSegment / onPcmFrame. Called whenever start()
   * is about to throw so a subsequent fallback session does not
   * inherit stale subscribers from the failed start attempt. The
   * caller (the failing branch) owns the throw itself.
   */
  private clearAudioSubscribers(): void {
    this.audioChunkCallbacks = [];
    this.segmentCallbacks = [];
    this.pcmFrameCallbacks = [];
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
    const useSystemAudio = this.deviceId === SYSTEM_AUDIO_DEVICE_ID;
    const useNativeMacOS = useSystemAudio && this.systemAudioBackend === 'macos-native';
    const path = useNativeMacOS ? 'macos-native/ScreenCaptureKit' : useSystemAudio ? 'getDisplayMedia/loopback' : 'getUserMedia';
    console.log(`[Audio] Starting capture (path=${path})`);

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

    if (useNativeMacOS) {
      // macOS native ScreenCaptureKit path. The main process drives
      // the native addon; we receive PCM over IPC and rebuild a
      // MediaStream from it so the downstream pipeline is unchanged.
      try {
        this.stream = await this.startNativeMacOSSource();
        const trackLabel = this.systemAudioPid
          ? `System Audio (app pid ${this.systemAudioPid})`
          : 'System Audio (whole system)';
        console.log(`[Audio] macOS native stream OK — ${trackLabel}`);
        this.emit({ micActive: true, deviceLabel: trackLabel, error: null });
      } catch (err) {
        console.error('[Audio] macOS native capture failed:', err);
        const msg = err instanceof Error ? err.message : 'macOS native capture failed';
        await this.stopNativeMacOSSource();
        try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        this.stream = null;
        try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
        this.clearAudioSubscribers();
        this.emit({ micActive: false, error: `System audio (macOS native): ${msg} / macOS 原生系统音频失败`, recording: false });
        throw new Error(msg);
      }
    } else if (useSystemAudio) {
      // getDisplayMedia requires a video constraint to be present even
      // when we only want audio. We ask for the smallest possible frame
      // (1×1 at 1 fps) and stop the video track immediately to free the
      // GPU encoder pipeline. The audio track from `audio:'loopback'`
      // is what we actually feed into the rest of the pipeline.
      try {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: {
            width: { ideal: 1 },
            height: { ideal: 1 },
            frameRate: { ideal: 1 },
          },
        });
        // Discard video tracks — we requested them only to satisfy the
        // getDisplayMedia spec; we never render or encode them.
        for (const t of this.stream.getVideoTracks()) {
          try { t.stop(); } catch { /* ignore */ }
          try { this.stream.removeTrack(t); } catch { /* ignore */ }
        }
        const audioTracks = this.stream.getAudioTracks();
        if (audioTracks.length === 0) {
          throw new DOMException(
            'No audio track in display-media stream (loopback unavailable)',
            'NotFoundError',
          );
        }
        const trackLabel = audioTracks[0]?.label || 'System Audio';
        console.log(`[Audio] System audio stream OK — ${trackLabel}`);
        this.emit({ micActive: true, deviceLabel: `System Audio · ${trackLabel}`, error: null });
      } catch (err) {
        console.error('[Audio] getDisplayMedia failed:', err);
        const msg = mapSystemAudioError(err);
        try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        this.stream = null;
        try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
        this.clearAudioSubscribers();
        this.emit({ micActive: false, error: msg, recording: false });
        throw new Error(msg);
      }
    } else {

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
      // Fallback to default device if we tried a specific one first.
      // If even the default device fails, throw so meeting-store's
      // mock-fallback catch runs. A previous version silently `return`ed
      // on this branch, which made capture.start() resolve with no
      // recorder configured — the session would then run with neither
      // real nor mock audio.
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
          const msg = mapMicError(fallbackErr);
          // We already opened the main-process file writer above
          // (audio.startRecording IPC). Close it before throwing so
          // the fallback session does not race a leaked file handle.
          try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
          this.clearAudioSubscribers();
          this.emit({ micActive: false, error: msg, recording: false });
          throw new Error(msg);
        }
      } else {
        const msg = mapMicError(err);
        try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
        this.clearAudioSubscribers();
        this.emit({ micActive: false, error: msg, recording: false });
        throw new Error(msg);
      }
    }
    } // end of getUserMedia branch (useSystemAudio === false)

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
      // Throw so meeting-store's mock-fallback catch runs. A previous
      // version `return`ed silently which left capture.start() resolved
      // with no recorder configured.
      const msg = `MediaRecorder failed: ${err instanceof Error ? err.message : 'Unknown'} / 录音器创建失败`;
      console.error('[Audio] MediaRecorder creation failed:', err);
      // If the stream came from the macOS native path, stop
      // ScreenCaptureKit in the main process too — otherwise the
      // SCStream keeps running after we abandon the renderer side.
      if (this.nativeActive) { await this.stopNativeMacOSSource(); }
      try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      this.stream = null;
      // Same as the getUserMedia throw paths: the main-process file
      // writer was opened earlier; close it before throwing.
      try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
      this.clearAudioSubscribers();
      this.emit({ error: msg, recording: false, micActive: false });
      throw new Error(msg);
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
        // Full cleanup symmetric with `stop()`: stop the recorder,
        // drain its in-flight ondataavailable promises, close the
        // main-process file writer, and release the MediaStream
        // tracks. A previous version skipped the drain + writer-close
        // here, so the fallback mock recording could race against
        // stale final-chunk state — the .webm file on disk would be
        // missing its trailing bytes and the IPC handle would still
        // be open when the mock tried to write to it.
        try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* ignore */ }
        try { await this.mainRecorderDone; } catch { /* ignore */ }
        this.recorder = null;
        // Stop ScreenCaptureKit in main if the stream came from there.
        if (this.nativeActive) { await this.stopNativeMacOSSource(); }
        try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        this.stream = null;
        try { await window.electronAPI?.audio.stopRecording(); } catch { /* ignore */ }
        this.clearAudioSubscribers();
        this.pcmStreamEnabled = false;
        this.emit({ error: `PCM stream setup failed: ${msg} / PCM 流启动失败`, recording: false, micActive: false });
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
    // Output batching. The worklet fires every render quantum (128
    // frames; ~2.7ms at 48kHz). Forwarding to subscribers at that
    // rate means hundreds of WebSocket sends per second to iFlytek
    // — well above what they recommend and what the network can
    // sustain cleanly. We accumulate ~40ms of post-resample audio
    // (640 samples at 16kHz, iFlytek's recommended frame size) and
    // emit one buffer per batch.
    const BATCH_SAMPLES = Math.round(targetSampleRate * 0.04); // 640 @ 16kHz
    let outBatch: number[] = [];
    const flushBatch = () => {
      if (outBatch.length === 0) return;
      const buf = new Float32Array(outBatch).buffer;
      for (const cb of this.pcmFrameCallbacks) cb(buf);
      outBatch = [];
    };

    this.pcmWorkletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this._state.recording || this.pcmFrameCallbacks.length === 0) return;
      const input = event.data;
      if (!input || input.length === 0) return;

      // Concatenate any leftover samples from the previous frame.
      const merged = new Float32Array(carry.length + input.length);
      merged.set(carry, 0);
      merged.set(input, carry.length);

      // Pick on the fixed grid: floor(phase + i*ratio) for i = 0, 1, 2, …
      while (true) {
        const idx = Math.floor(phase);
        if (idx >= merged.length) break;
        outBatch.push(merged[idx]);
        phase += ratio;
        if (outBatch.length >= BATCH_SAMPLES) {
          flushBatch();
        }
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
   * Build a MediaStream from the macOS native ScreenCaptureKit PCM
   * feed. Sequence:
   *
   *   1. AudioContext at 16 kHz (matches the native addon's output
   *      rate, so the playback worklet replays 1:1 with no resample).
   *   2. Playback AudioWorklet (pcm-playback-worklet) that ring-buffers
   *      incoming PCM and emits it on the render thread.
   *   3. MediaStreamAudioDestinationNode whose `.stream` is returned —
   *      this is what the normal MediaRecorder / segment / resampler
   *      pipeline consumes downstream.
   *   4. Subscribe to IPC PCM frames + error events from the main
   *      process, then ask main to start the native capture.
   *
   * Throws (after cleaning up partial state) if the main process
   * reports the native start failed, so start()'s catch can fall back.
   */
  private async startNativeMacOSSource(): Promise<MediaStream> {
    const macos = window.electronAPI?.audio.macos;
    if (!macos) {
      throw new Error('macOS native capture IPC bridge is unavailable (preload missing audio.macos)');
    }

    // Mark the native path "engaged" BEFORE any await. nativeActive
    // gates whether stop() tears the native side down. If we only set
    // it after `await macos.start()` resolved, a stop() during that
    // await would skip stopNativeMacOSSource() and leak the SCStream +
    // IPC listeners on the main side. Setting it now means every
    // teardown path (doStop, MediaRecorder failure, PCM failure, this
    // method's own throw) cleans up the native session.
    this.nativeActive = true;

    // 16 kHz context so the worklet replays the native PCM 1:1.
    const ctx = new AudioContext({ sampleRate: 16000 });
    this.nativePlaybackCtx = ctx;

    const { PCM_PLAYBACK_WORKLET_SOURCE, PCM_PLAYBACK_WORKLET_NAME } = await import('./pcm-playback-worklet');
    const blob = new Blob([PCM_PLAYBACK_WORKLET_SOURCE], { type: 'application/javascript' });
    this.nativePlaybackUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(this.nativePlaybackUrl);

    const playerNode = new AudioWorkletNode(ctx, PCM_PLAYBACK_WORKLET_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.nativePlaybackNode = playerNode;

    const dest = ctx.createMediaStreamDestination();
    playerNode.connect(dest);

    // Pump IPC PCM frames into the worklet's ring buffer. We transfer
    // the underlying buffer to avoid a copy across the postMessage.
    this.nativePcmUnsub = macos.onPcmFrame((buf: ArrayBuffer) => {
      if (!this._state.recording) return;
      const f32 = new Float32Array(buf);
      try {
        playerNode.port.postMessage(f32, [f32.buffer]);
      } catch { /* worklet torn down mid-flight */ }
    });
    this.nativeErrorUnsub = macos.onError((err: { message: string; code: number }) => {
      // Fatal SCStream error (permission revoked mid-session, target
      // app quit, etc.). The native session has already torn itself
      // down on the main side (didStopWithError → Idle). The renderer
      // pipeline would otherwise keep recording silence, so we tear
      // the whole capture down here. stop() is re-entrancy-guarded, so
      // a near-simultaneous user-initiated stop won't double-run.
      console.error('[Audio] macOS native capture error — stopping session:', err);
      this.emit({ error: `System audio capture stopped: ${err.message} (code ${err.code}) / 系统音频捕获中断` });
      if (this._state.recording) {
        void this.stop().catch((e) => console.error('[Audio] stop() after native error failed:', e));
      }
    });

    // Pre-start cancellation check. The AudioContext / worklet setup
    // above contains awaits; if stop() ran during them, doStop() will
    // have called stopNativeMacOSSource() and cleared nativeActive.
    // We must NOT issue macos.start() after a stop — otherwise
    // ScreenCaptureKit starts (and possibly stalls on a permission
    // prompt) AFTER the session was torn down. This check is
    // synchronous and immediately precedes the start call, so no
    // stop() can interleave between the check and the call.
    if (!this.nativeActive) {
      throw new Error('macOS native capture was stopped during setup');
    }

    // Ask the main process to start ScreenCaptureKit. If this rejects
    // (permission denied, no displays, pid gone), the caller's catch
    // tears everything down.
    const res = await macos.start({ pid: this.systemAudioPid ?? undefined });
    if (!res.ok) {
      throw new Error(res.error || 'native start returned ok:false');
    }

    // Post-start cancellation check. If stop() ran while we were
    // awaiting macos.start(), it sent macos.stop() (the native state
    // machine turns that into a cancel) and cleared nativeActive.
    // Don't hand a now-dead stream back to start() for MediaRecorder
    // wiring; throw so start()'s catch cleans up the rest.
    if (!this.nativeActive) {
      throw new Error('macOS native capture was stopped during start');
    }

    // nativeActive was already set at the top of this method.
    return dest.stream;
  }

  /**
   * Tear down the macOS native source created in
   * startNativeMacOSSource(). Safe to call when the native path was
   * never started — every branch checks for null. Unsubscribes IPC
   * listeners, tells main to stop ScreenCaptureKit, and closes the
   * playback AudioContext.
   */
  private async stopNativeMacOSSource(): Promise<void> {
    try { this.nativePcmUnsub?.(); } catch { /* ignore */ }
    try { this.nativeErrorUnsub?.(); } catch { /* ignore */ }
    this.nativePcmUnsub = null;
    this.nativeErrorUnsub = null;

    // Tell main to stop the native capture regardless of our local
    // `nativeActive` flag — start() may have failed AFTER the main
    // process began capturing (e.g. the playback graph threw), and we
    // must not leak a live SCStream.
    try { await window.electronAPI?.audio.macos?.stop(); } catch { /* ignore */ }

    try { this.nativePlaybackNode?.disconnect(); } catch { /* ignore */ }
    if (this.nativePlaybackCtx) {
      try { await this.nativePlaybackCtx.close(); } catch { /* ignore */ }
    }
    if (this.nativePlaybackUrl) {
      try { URL.revokeObjectURL(this.nativePlaybackUrl); } catch { /* ignore */ }
      this.nativePlaybackUrl = null;
    }
    this.nativePlaybackNode = null;
    this.nativePlaybackCtx = null;
    this.nativeActive = false;
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

  // Guards stop() against re-entrancy: a fatal native-error handler
  // and a user-initiated stop can fire near-simultaneously. The first
  // call owns teardown; the second awaits the same promise.
  private stopInFlight: Promise<string> | null = null;

  async stop(): Promise<string> {
    if (this.stopInFlight) return this.stopInFlight;
    this.stopInFlight = this.doStop().finally(() => { this.stopInFlight = null; });
    return this.stopInFlight;
  }

  private async doStop(): Promise<string> {
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

    // Tear down the macOS native source (no-op when the native path
    // was not used). Stops ScreenCaptureKit in the main process,
    // unsubscribes IPC, and closes the playback context. Done before
    // we stop the local MediaStream tracks because the native source
    // IS that stream's producer.
    if (this.nativeActive) {
      await this.stopNativeMacOSSource();
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
