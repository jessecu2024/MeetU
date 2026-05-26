// Tests for the renderer-side capture-manager pieces that we can
// exercise without a real browser audio stack (the start()/stop()
// pipeline depends on MediaRecorder + AudioContext + window.electronAPI
// and is covered by integration testing instead).
//
// These tests focus on:
//   - The SYSTEM_AUDIO_DEVICE_ID sentinel stays distinct from any
//     plausible real device id, including the legacy "default" value.
//   - mapSystemAudioError covers every DOMException name we expect
//     from getDisplayMedia (the names are stable per the spec) and
//     produces bilingual strings the UI can render verbatim.
//
// Why this matters: getting the sentinel wrong (e.g. accidentally
// using a string a browser might emit as an actual deviceId) would
// silently route real microphone selections through the system-audio
// branch. Getting the error-mapper wrong means users see "Audio
// error: Undefined" instead of the System Settings instructions for
// granting Screen Recording permission.
import { describe, it, expect } from 'vitest';
import { SYSTEM_AUDIO_DEVICE_ID, mapSystemAudioError } from './capture';

describe('SYSTEM_AUDIO_DEVICE_ID sentinel', () => {
  it('is a distinctive underscore-wrapped string that cannot collide with a real device id', () => {
    // Real audio deviceIds are non-empty hex hashes; "default" and
    // "communications" are the only standardized non-hash values.
    expect(SYSTEM_AUDIO_DEVICE_ID).toBe('__system_audio__');
    expect(SYSTEM_AUDIO_DEVICE_ID).not.toBe('');
    expect(SYSTEM_AUDIO_DEVICE_ID).not.toBe('default');
    expect(SYSTEM_AUDIO_DEVICE_ID).not.toBe('communications');
    expect(SYSTEM_AUDIO_DEVICE_ID.startsWith('__')).toBe(true);
    expect(SYSTEM_AUDIO_DEVICE_ID.endsWith('__')).toBe(true);
  });
});

function domException(name: string, message = ''): DOMException {
  return new DOMException(message, name);
}

describe('mapSystemAudioError', () => {
  it('maps NotAllowedError to a Screen Recording permission walkthrough', () => {
    const msg = mapSystemAudioError(domException('NotAllowedError'));
    expect(msg).toMatch(/Screen Recording/);
    expect(msg).toMatch(/System Settings/);
    // Bilingual: must mention macOS-specific UI in English AND give a
    // Chinese translation in the same string (matches the UI's pattern
    // elsewhere).
    expect(msg).toMatch(/系统设置/);
  });

  it('maps NotFoundError to a "no source available" hint', () => {
    const msg = mapSystemAudioError(domException('NotFoundError'));
    expect(msg).toMatch(/No system audio source/);
    expect(msg).toMatch(/未找到/);
  });

  it('maps NotSupportedError to an OS-version requirement', () => {
    const msg = mapSystemAudioError(domException('NotSupportedError'));
    expect(msg).toMatch(/macOS 13\+ or Windows 10\+/);
    expect(msg).toMatch(/不支持/);
  });

  it('maps AbortError to "main process rejected" (the setDisplayMediaRequestHandler returned {})', () => {
    const msg = mapSystemAudioError(domException('AbortError'));
    expect(msg).toMatch(/main process/i);
    expect(msg).toMatch(/主进程/);
  });

  it('maps NotReadableError to "device busy" with concrete other-app guidance', () => {
    const msg = mapSystemAudioError(domException('NotReadableError'));
    expect(msg).toMatch(/busy/i);
    // Names real apps that commonly hold the screen-capture engine on
    // macOS so the user can find and quit them.
    expect(msg).toMatch(/Loom|OBS|QuickTime/);
    expect(msg).toMatch(/繁忙|不可读/);
  });

  it('maps InvalidStateError to a "bring window to foreground" hint', () => {
    const msg = mapSystemAudioError(domException('InvalidStateError'));
    expect(msg).toMatch(/foreground/i);
    expect(msg).toMatch(/前台/);
  });

  it('maps OverconstrainedError to "constraints not satisfied — likely a bug"', () => {
    const msg = mapSystemAudioError(domException('OverconstrainedError'));
    expect(msg).toMatch(/constraints/i);
    expect(msg).toMatch(/bug/i);
    expect(msg).toMatch(/约束/);
  });

  it('maps SecurityError to "main process missing handler — reinstall"', () => {
    const msg = mapSystemAudioError(domException('SecurityError'));
    expect(msg).toMatch(/security/i);
    expect(msg).toMatch(/reinstall/i);
  });

  it('maps TypeError to "bad constraints — likely a bug"', () => {
    const msg = mapSystemAudioError(domException('TypeError'));
    expect(msg).toMatch(/bad constraints/i);
    expect(msg).toMatch(/bug/i);
  });

  it('falls back to a generic message for unknown DOMException names', () => {
    const msg = mapSystemAudioError(domException('SomeFutureDOMError', 'oops'));
    expect(msg).toMatch(/System audio error/);
    expect(msg).toMatch(/系统音频错误/);
    expect(msg).toMatch(/oops/);
  });

  it('falls back gracefully when given a non-DOMException object', () => {
    const msg = mapSystemAudioError(new Error('plain js error'));
    expect(msg).toMatch(/System audio error/);
    expect(msg).toMatch(/plain js error/);
  });

  it('does not crash on null/undefined', () => {
    expect(() => mapSystemAudioError(null)).not.toThrow();
    expect(() => mapSystemAudioError(undefined)).not.toThrow();
    const msg = mapSystemAudioError(null);
    expect(msg).toMatch(/System audio error/);
  });
});
