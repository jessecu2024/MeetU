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
  // ── darwin gating ──
  // Electron 30's `setDisplayMediaRequestHandler` typedef explicitly
  // says `audio:'loopback'` is supported on Windows only. Even though
  // ScreenCaptureKit itself ships in macOS 13+, the Electron renderer
  // path is not wired to use it. Returning `supported:true` on darwin
  // would let the renderer race a request that silently produces dead
  // audio or rejects with NotAllowedError — no actionable recovery.
  // The probe MUST return `supported:false` on every darwin version
  // until either (a) Electron exposes the macOS path or (b) the
  // native N-API module (PR #4b) replaces this code path entirely.

  it('rejects darwin 13.0.0 because Electron getDisplayMedia loopback is Windows-only', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/macOS/);
    expect(r.reason).toMatch(/Windows only|仅 Windows/);
  });

  it('rejects darwin 14.4 (current macOS) — version is not the gating reason; the wrapper path is', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '14.4' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/roadmap|路线图/);
  });

  it('rejects darwin 12.7.4 (also unsupported on this wrapper path)', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '12.7.4' });
    expect(r.supported).toBe(false);
  });

  it('rejects darwin with empty / garbage version (unsupported regardless)', () => {
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '' }).supported).toBe(false);
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'unknown' }).supported).toBe(false);
    expect(probeSystemAudioSupport({ platform: 'darwin', macOsVersion: 'v13.0.0' }).supported).toBe(false);
  });

  it('echoes the screen-recording permission status on darwin (UI may still want to display it)', () => {
    const r = probeSystemAudioSupport({
      platform: 'darwin',
      macOsVersion: '14.0.0',
      screenPermission: 'granted',
    });
    expect(r.permission).toBe('granted');
  });

  it('defaults permission to "unknown" on darwin when not provided', () => {
    const r = probeSystemAudioSupport({ platform: 'darwin', macOsVersion: '13.0.0' });
    expect(r.permission).toBe('unknown');
  });

  // ── win32 gating: the only platform actually supported today ──

  it('rejects win32 with "10-rc" suffix (parseInt would silently accept)', () => {
    const r = probeSystemAudioSupport({ platform: 'win32', winRelease: '10-rc' });
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/Windows 10/);
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
    expect(r.reason).toMatch(/Windows 10\+ only/);
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
