// ============================================================
// System-Audio Loopback Capability Probe
//
// Pure function that decides whether the current OS can deliver the
// Electron getDisplayMedia + audio:'loopback' path:
//   - macOS 13+ wraps ScreenCaptureKit
//   - Windows 10+ wraps WASAPI loopback
//   - All other platforms (Linux, older macOS / Windows) are unsupported.
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
 * Strict major-version extractor. Returns `NaN` for any input that
 * does not start with one or more digits followed by either a dot
 * separator or end-of-string. This is intentional:
 *
 *   "13.4.0"   -> 13
 *   "13"       -> 13
 *   "10.0.226" -> 10
 *   ""         -> NaN   (cannot confirm — must reject)
 *   "v13.0"    -> NaN   (leading non-digit — must reject)
 *   "13-beta"  -> NaN   (suffix is not a dot/EOS — must reject)
 *
 * The previous implementation used `parseInt(s.split('.')[0])` which
 * lenient-parsed `"13-beta"` as 13 (parseInt strips trailing junk)
 * and was hostile to `"v13.0.0"` (returned NaN, but then `NaN < 13`
 * is `false`, mis-marking the platform as supported).
 */
function parseMajor(version: string): number {
  const m = /^(\d+)(?:\.|$)/.exec(version);
  return m ? parseInt(m[1], 10) : NaN;
}

export function probeSystemAudioSupport(inputs: SystemAudioProbeInputs): SystemAudioProbeResult {
  const { platform, macOsVersion, winRelease, screenPermission } = inputs;

  if (platform === 'darwin') {
    const versionStr = macOsVersion ?? '';
    const major = parseMajor(versionStr);
    // Number.isFinite is the only safe predicate here: `NaN >= 13`,
    // `NaN < 13`, and `NaN === NaN` are all false. We must explicitly
    // reject the unparseable case so a malformed `process.getSystemVersion()`
    // does not slip past as "supported".
    if (!Number.isFinite(major) || major < 13) {
      return {
        supported: false,
        reason: `macOS 13 (Ventura) or newer required for ScreenCaptureKit; detected ${versionStr || '(unknown)'}. / 需要 macOS 13 或更新版本，当前 ${versionStr || '未知'}`,
      };
    }
    return {
      supported: true,
      permission: screenPermission || 'unknown',
      version: versionStr,
    };
  }

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

  return {
    supported: false,
    reason: 'System audio capture is supported on macOS 13+ and Windows 10+ only. / 系统音频捕获仅支持 macOS 13+ 与 Windows 10+',
  };
}
