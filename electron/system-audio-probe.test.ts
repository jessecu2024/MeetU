// Tests for the platform/version gating in
// `probeSystemAudioSupport`. The function is the single source of
// truth that decides whether the renderer offers the System Audio
// loopback option in Settings — getting the version cut-off wrong
// means users on supported OSes lose the feature, or worse, users on
// unsupported OSes see it offered and then hit an opaque DOMException
// at record time.
import { describe, it, expect } from 'vitest';
import { probeSystemAudioSupport } from './system-audio-probe';

describe('probeSystemAudioSupport', () => {
  // ── darwin: native ScreenCaptureKit path (PR #4b) ──
  // macOS 13+ is supported via the native addon, NOT via Electron's
  // getDisplayMedia (which is Windows-only). The probe upgrades darwin
  // to `mode:'macos-native'` ONLY when the caller reports the addon
  // loaded (`macOSNativeAvailable:true`). Without the addon, darwin is
  // unsupported with an actionable reason. macOS <13 is always
  // unsupported (ScreenCaptureKit requires 13+).

  it('supports darwin 13.0.0 when the native addon is available, in macos-native mode with per-app capture', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0', macOSNativeAvailable: true });
    expect(r.supported).toBe(true);
    expect(r.mode).toBe('macos-native');
    expect(r.perAppCapture).toBe(true);
    expect(r.version).toBe('13.0.0');
  });

  it('supports darwin 14.4 (no patch) when the native addon is available', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '14.4', macOSNativeAvailable: true });
    expect(r.supported).toBe(true);
    expect(r.mode).toBe('macos-native');
  });

  it('rejects darwin 13+ when the native addon failed to load, surfacing the loader reason', () => {
    const r = probeSystemAudioSupport({
      platform: 'darwin',
      macOsVersion: '14.0.0',
      macOSNativeAvailable: false,
      macOSNativeReason: 'Could not load build/Release/meetu_screencapture.node: dlopen failed',
    });
    expect(r.supported).toBe(false);
    expect(r.mode).toBeUndefined();
    expect(r.reason).toMatch(/dlopen failed/);
  });

  it('rejects darwin 13+ with a generic reason when the addon is unavailable and no reason is given', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.6.0', macOSNativeAvailable: false });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/npm rebuild|not loaded/);
  });

  it('rejects darwin 12.7.4 outright — ScreenCaptureKit requires macOS 13+, even if the addon claims available', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '12.7.4', macOSNativeAvailable: true });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/macOS 13/);
    expect(r.reason).toMatch(/12\.7\.4/);
  });

  it('rejects darwin with empty / garbage version (cannot confirm macOS 13+)', () => {
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '', macOSNativeAvailable: true }).supported).toBe(false);
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'unknown', macOSNativeAvailable: true }).supported).toBe(false);
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'v13.0.0', macOSNativeAvailable: true }).supported).toBe(false);
  });

  it('echoes the screen-recording permission status on darwin (supported AND unsupported paths)', () => {
    const ok = probeSystemAudioSupport({
      platform: 'darwin', macOsVersion: '14.0.0', macOSNativeAvailable: true, screenPermission: 'granted',
    });
    expect(ok.permission).toBe('granted');
    const denied = probeSystemAudioSupport({
      platform: 'darwin', macOsVersion: '14.0.0', macOSNativeAvailable: false, screenPermission: 'denied',
    });
    expect(denied.permission).toBe('denied');
  });

  it('defaults permission to "unknown" on darwin when not provided', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0', macOSNativeAvailable: true });
    expect(r.permission).toBe('unknown');
  });

  // ── win32: Electron getDisplayMedia + WASAPI loopback ──

  it('rejects win32 with "10-rc" suffix (parseInt would silently accept)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10-rc' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/Windows 10/);
  });

  it('marks Windows 10 supported in electron-loopback mode WITHOUT per-app capture', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10.0.19042' });
    expect(r.supported).toBe(true);
    expect(r.mode).toBe('electron-loopback');
    expect(r.perAppCapture).toBe(false);
    expect(r.version).toBe('10.0.19042');
  });

  it('marks Windows 11 (release 10.0.22631) as supported (still major=10)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10.0.22631' });
    expect(r.supported).toBe(true);
    expect(r.mode).toBe('electron-loopback');
  });

  it('rejects Windows 8.1 (release 6.3.x) with version detail', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '6.3.9600' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/Windows 10/);
    expect(r.reason).toMatch(/6\.3\.9600/);
  });

  it('rejects Windows 7 (release 6.1.x)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '6.1.7601' });
    expect(r.supported).toBe(false);
  });

  it('rejects win32 with an empty release string', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '' });
    expect(r.supported).toBe(false);
  });

  it('rejects Linux outright with a clear platform message', () => {
    const r = probeSystemAudioSupport({ platform: 'linux' });
    expect(r.supported).toBe(false);
    expect(r.mode).toBeUndefined();
    expect(r.reason).toMatch(/Windows 10\+/);
    expect(r.reason).toMatch(/macOS 13\+/);
  });

  it('rejects freebsd / other unix platforms', () => {
    const r = probeSystemAudioSupport({ platform: 'freebsd' as NodeJS.Platform });
    expect(r.supported).toBe(false);
  });

  it('never echoes user-supplied permission on non-darwin platforms', () => {
    const r = probeSystemAudioSupport({
      platform: 'win32',
      winRelease: '10.0.19042',
      // Some bug/dev-tooling could pass this through — make sure it
      // doesn't leak into the win32 result (where it has no meaning).
      screenPermission: 'denied',
    });
    expect(r.permission).toBeUndefined();
  });
});
