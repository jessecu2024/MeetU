// ============================================================
// System-Audio Loopback Capability Probe
//
// Pure function that decides whether the current OS can deliver the
// Electron getDisplayMedia + audio:'loopback' path. Per Electron 30's
// own typedef (node_modules/electron/electron.d.ts):
//
//   "Specifying a loopback device will capture system audio, and is
//    currently only supported on Windows."
//
// So the supported matrix today is:
//   - Windows 10+         -> supported (wraps WASAPI loopback)
//   - macOS (any version) -> NOT supported on this path; native
//                            ScreenCaptureKit module ships in PR #4b
//   - Linux / other       -> NOT supported
//
// The darwin branch still echoes the Screen Recording permission
// status from Electron's systemPreferences for diagnostics only —
// future code (or PR #4b) may surface it, but it never flips the
// `supported` flag here.
//
// Extracted from `registerIPC()` so the version-parsing branches can
// be unit-tested without standing up an Electron app/session.
// ============================================================

export interface SystemAudioProbeInputs {
  platform: NodeJS.Platform;
  /** `process.getSystemVersion()` on darwin — the actual macOS version (e.g. "13.4.0"), NOT the Darwin kernel version. */
  macOsVersion?: string;
  /** `os.release()` on win32 (e.g. "10.0.19042"). */
  winRelease?: string;
  /** `systemPreferences.getMediaAccessStatus('screen')` on darwin, when available. */
  screenPermission?: string;
}

export interface SystemAudioProbeResult {
  supported: boolean;
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
  const { platform, macOsVersion, winRelease, screenPermission } = inputs;

  if (platform === 'win32') {
    const releaseStr = winRelease ?? '';
    const major = parseMajor(releaseStr);
    if (!Number.isFinite(major) || major < 10) {
      return {
        supported: false,
        reason: `Windows 10 or newer required for WASAPI loopback; detected ${releaseStr || '(unknown)'}. / 需要 Windows 10 或更新版本，当前 ${releaseStr || '未知'}`,
      };
    }
    return { supported: true, version: releaseStr };
  }

  if (platform === 'darwin') {
    // macOS gating intentionally returns unsupported even though
    // ScreenCaptureKit itself shipped in macOS 13.
    //
    // Per the bundled Electron typedef (node_modules/electron/electron.d.ts):
    //   "Specifying a loopback device will capture system audio, and is
    //    currently only supported on Windows."
    //
    // Electron 30 does NOT expose ScreenCaptureKit's loopback path to
    // the renderer's `getDisplayMedia({audio:'loopback'})` call on
    // macOS. Returning supported:true here would let the renderer race
    // a request that either silently returns a dead audio track or
    // rejects with NotAllowedError, and the user has no actionable
    // recovery. Honest gating: this path is Windows-only today;
    // macOS will land via the native N-API module (PR #4b).
    const versionStr = macOsVersion ?? '';
    return {
      supported: false,
      reason: `Native system-audio loopback on macOS is not yet enabled in MeetU. Electron 30's getDisplayMedia path supports loopback on Windows only; macOS support ships via the per-app ScreenCaptureKit native module (roadmap). For now, route system audio through a non-GPL virtual audio cable and pick it in the device list. / macOS 原生系统音频 loopback 暂未启用,Electron 30 的 getDisplayMedia 路径目前仅 Windows 支持;macOS 将通过原生 ScreenCaptureKit 模块上线(路线图)。请用非 GPL 虚拟音频线缆作为替代${versionStr ? `(detected ${versionStr})` : ''}`,
      permission: screenPermission || 'unknown',
      version: versionStr,
    };
  }

  return {
    supported: false,
    reason: 'System audio capture (driverless loopback) is supported on Windows 10+ only at this time. macOS native loopback is on the roadmap. / 驱动免安装的系统音频 loopback 目前仅支持 Windows 10+,macOS 原生 loopback 在路线图中',
  };
}
