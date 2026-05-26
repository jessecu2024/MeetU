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
  it('marks macOS 13.0.0 as supported (ScreenCaptureKit cutoff)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0' });
    expect(r.supported).toBe(true);
    expect(r.version).toBe('13.0.0');
  });

  it('marks macOS 14.4 (no patch) as supported', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '14.4' });
    expect(r.supported).toBe(true);
  });

  it('rejects macOS 12.7.4 with an actionable reason', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '12.7.4' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/macOS 13/);
    expect(r.reason).toMatch(/12\.7\.4/);
  });

  it('rejects macOS 11.x', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '11.6.0' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with an empty version string (cannot confirm)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/macOS 13/);
  });

  it('rejects darwin with "13-beta" (lenient parseInt would have allowed it)', () => {
    // parseInt('13-beta') === 13, which the previous implementation
    // would have accepted. The strict regex must reject it because
    // "-beta" is neither a dot nor end-of-string after the digit run.
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13-beta' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/macOS 13/);
    expect(r.reason).toMatch(/13-beta/);
  });

  it('rejects darwin with "v13.0.0" leading non-digit', () => {
    // parseInt('v13.0.0') === NaN; lenient `NaN < 13` is false, so the
    // previous implementation mis-marked this as supported. The strict
    // parser must reject.
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'v13.0.0' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with garbage version (only non-digits)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'unknown' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with "13.beta" (non-digit second component)', () => {
    // The previous regex /^(\d+)(?:\.|$)/ matched the leading "13."
    // and accepted this as major=13. The stricter /^(\d+)(?:\.\d+)*$/
    // requires every component to be a digit run.
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.beta' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with "13." (dangling dot)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with "13..0" (empty component)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13..0' });
    expect(r.supported).toBe(false);
  });

  it('accepts darwin with single-digit major "13" (no dotted components)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13' });
    expect(r.supported).toBe(true);
  });

  it('rejects win32 with "10-rc" suffix (parseInt would silently accept)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10-rc' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/Windows 10/);
  });

  it('surfaces the screen-recording permission status verbatim when granted', () => {
    const r = probeSystemAudioSupport({
      platform: 'darwin',
      macOsVersion: '14.0.0',
      screenPermission: 'granted',
    });
    expect(r.supported).toBe(true);
    expect(r.permission).toBe('granted');
  });

  it('surfaces a denied screen-recording permission so the UI can warn the user', () => {
    const r = probeSystemAudioSupport({
      platform: 'darwin',
      macOsVersion: '13.6.0',
      screenPermission: 'denied',
    });
    // Permission denied is intentionally NOT a hard `supported:false` —
    // the renderer still offers the option and shows a guidance banner
    // so the user can grant access in System Settings without leaving
    // the app first to find out the option exists. The probe surfaces
    // the raw status; the UI decides the messaging.
    expect(r.supported).toBe(true);
    expect(r.permission).toBe('denied');
  });

  it('defaults permission to "unknown" when not provided on darwin', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0' });
    expect(r.permission).toBe('unknown');
  });

  it('marks Windows 10 (release 10.0.19042) as supported (WASAPI loopback cutoff)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10.0.19042' });
    expect(r.supported).toBe(true);
    expect(r.version).toBe('10.0.19042');
  });

  it('marks Windows 11 (release 10.0.22631) as supported (still major=10)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10.0.22631' });
    expect(r.supported).toBe(true);
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
    expect(r.reason).toMatch(/macOS 13\+ and Windows 10\+/);
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
