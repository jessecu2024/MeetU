// ============================================================
// System-Audio Capability Probe
//
// Pure function that decides whether — and HOW — the current OS
// can capture system audio without a GPL driver. There are two
// distinct backends:
//
//   1. Electron getDisplayMedia + audio:'loopback'
//      Per Electron 30's typedef (node_modules/electron/electron.d.ts):
//        "Specifying a loopback device will capture system audio,
//         and is currently only supported on Windows."
//      => Windows 10+ only. Wraps WASAPI loopback.
//
//   2. Native ScreenCaptureKit N-API module (native/macos)
//      => macOS 13+ only, AND only when the addon actually built &
//         loaded (probed by the caller and passed in as
//         `macOSNativeAvailable`). Adds per-application capture,
//         which the Electron wrapper cannot do on any platform.
//
// Resulting `mode` tells the renderer which path to drive:
//   - 'electron-loopback' -> getDisplayMedia({audio:'loopback'})
//   - 'macos-native'      -> IPC to the native ScreenCaptureKit addon
//   - undefined           -> unsupported; fall back to getUserMedia +
//                            virtual cable / Stereo Mix
//
// Extracted from `registerIPC()` so the version-parsing and
// backend-selection branches can be unit-tested without standing
// up an Electron app/session.
// ============================================================

export type SystemAudioMode = 'electron-loopback' | 'macos-native';

export interface SystemAudioProbeInputs {
  platform: NodeJS.Platform;
  /** `process.getSystemVersion()` on darwin — the actual macOS version (e.g. "13.4.0"), NOT the Darwin kernel version. */
  macOsVersion?: string;
  /** `os.release()` on win32 (e.g. "10.0.19042"). */
  winRelease?: string;
  /** `systemPreferences.getMediaAccessStatus('screen')` on darwin, when available. */
  screenPermission?: string;
  /**
   * Whether the native ScreenCaptureKit addon (native/macos) built
   * and loaded successfully in this process. Only meaningful on
   * darwin. The caller probes the addon and passes the result in so
   * this function stays pure (no require()/fs side effects).
   */
  macOSNativeAvailable?: boolean;
  /**
   * The loader's failure reason when `macOSNativeAvailable` is false.
   * Surfaced to the user so a missing/broken build is actionable
   * (e.g. "run npm rebuild") rather than a silent grey-out.
   */
  macOSNativeReason?: string;
}

export interface SystemAudioProbeResult {
  supported: boolean;
  /** Which backend the renderer should drive. Absent when unsupported. */
  mode?: SystemAudioMode;
  /** True only on the macOS native path — enables the per-app picker UI. */
  perAppCapture?: boolean;
  reason?: string;
  permission?: string;
  version?: string;
}

/**
 * Strict major-version extractor. Requires the ENTIRE input to be a
 * dotted-decimal version (one-or-more digit runs separated by single
 * dots, no leading non-digit, no trailing suffix). Returns the first
 * component as an integer; returns `NaN` otherwise.
 *
 *   "13.4.0"   -> 13
 *   "13"       -> 13
 *   "10.0.226" -> 10
 *   ""         -> NaN
 *   "v13.0"    -> NaN   (leading non-digit)
 *   "13-beta"  -> NaN   (suffix after digit run)
 *   "13.beta"  -> NaN   ("beta" is not a digit run)
 *   "13."      -> NaN   (dangling dot — not a complete component)
 *   "13..0"    -> NaN   (empty component between dots)
 *   "unknown"  -> NaN
 *
 * Earlier iterations of this regex (`/^(\d+)(?:\.|$)/`) only validated
 * the first separator and accepted `"13.beta"` / `"13."` / `"13..0"`
 * as "13". A round-2 codex review flagged that, so the regex now
 * requires every component to be a digit run. The original
 * `parseInt('13-beta') === 13` and `parseInt('v13.0.0') === NaN`
 * (where `NaN < 13` evaluates to false) failure modes are also
 * blocked by this stricter shape.
 */
function parseMajor(version: string): number {
  const m = /^(\d+)(?:\.\d+)*$/.exec(version);
  return m ? parseInt(m[1], 10) : NaN;
}

export function probeSystemAudioSupport(inputs: SystemAudioProbeInputs): SystemAudioProbeResult {
  const { platform, macOsVersion, winRelease, screenPermission, macOSNativeAvailable, macOSNativeReason } = inputs;

  if (platform === 'win32') {
    const releaseStr = winRelease ?? '';
    const major = parseMajor(releaseStr);
    if (!Number.isFinite(major) || major < 10) {
      return {
        supported: false,
        reason: `Windows 10 or newer required for WASAPI loopback; detected ${releaseStr || '(unknown)'}. / 需要 Windows 10 或更新版本，当前 ${releaseStr || '未知'}`,
      };
    }
    // Electron's getDisplayMedia loopback path. No per-app capture
    // (the Electron wrapper captures the whole system mix only).
    return { supported: true, mode: 'electron-loopback', perAppCapture: false, version: releaseStr };
  }

  if (platform === 'darwin') {
    const versionStr = macOsVersion ?? '';
    const major = parseMajor(versionStr);

    // ScreenCaptureKit itself requires macOS 13+. Even if the addon
    // somehow loaded on an older OS, the runtime `@available` guard
    // in audio_tap.mm would have reported available=false, so the
    // loader passes macOSNativeAvailable=false here. We still check
    // the version explicitly to produce a clearer message.
    if (!Number.isFinite(major) || major < 13) {
      return {
        supported: false,
        reason: `macOS 13 (Ventura) or newer required for ScreenCaptureKit; detected ${versionStr || '(unknown)'}. Use a non-GPL virtual audio cable instead. / 需要 macOS 13 或更新版本，当前 ${versionStr || '未知'}；请改用非 GPL 虚拟音频线缆`,
        permission: screenPermission || 'unknown',
        version: versionStr,
      };
    }

    if (!macOSNativeAvailable) {
      // macOS 13+ but the native addon didn't build/load. This is the
      // honest "the feature exists but isn't installed on your build"
      // case — surface the loader reason so the user can fix it.
      return {
        supported: false,
        reason: macOSNativeReason
          ? `macOS native system-audio module is unavailable: ${macOSNativeReason} / macOS 原生系统音频模块不可用：${macOSNativeReason}`
          : 'macOS native system-audio module is not loaded. Reinstall MeetU or run `npm rebuild`. / macOS 原生系统音频模块未加载，请重装或运行 npm rebuild',
        permission: screenPermission || 'unknown',
        version: versionStr,
      };
    }

    // macOS 13+ AND the native ScreenCaptureKit addon is live.
    // perAppCapture:true unlocks the per-application picker — the
    // unique capability this native path adds over Electron's
    // Windows-only wrapper.
    return {
      supported: true,
      mode: 'macos-native',
      perAppCapture: true,
      permission: screenPermission || 'unknown',
      version: versionStr,
    };
  }

  return {
    supported: false,
    reason: 'System audio capture is supported on Windows 10+ (WASAPI loopback) and macOS 13+ (native ScreenCaptureKit) only. / 系统音频捕获仅支持 Windows 10+(WASAPI loopback) 与 macOS 13+(原生 ScreenCaptureKit)',
  };
}
