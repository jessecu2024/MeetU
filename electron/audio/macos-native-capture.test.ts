// Tests for the main-process IPC wrapper around the macOS native
// ScreenCaptureKit addon. We exercise the REAL makeMacOSNativeCaptureIpc()
// by injecting a fake loader (its optional second arg), so the
// production glue — PCM forwarding, error translation, ok:false on
// failure — is what's under test, not a copy.
//
// The native module itself (audio_tap.mm) is verified by the build +
// load smoke test (npm run build:macos-native); its ScreenCaptureKit
// behavior needs real macOS audio hardware + granted permission and is
// out of scope for unit tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMacOSNativeCaptureIpc } from './macos-native-capture';
import type { AvailableLoader, StartOptions } from '../../native/macos';

function makeFakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
      },
    } as unknown as import('electron').BrowserWindow,
    sent,
  };
}

describe('makeMacOSNativeCaptureIpc — unavailable loader', () => {
  const unavailable: AvailableLoader = { available: false, reason: 'addon not built on this platform' };

  it('probe reports unavailable with the loader reason', async () => {
    const ipc = makeMacOSNativeCaptureIpc(() => null, () => unavailable);
    const res = await ipc.probe();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/not built/);
  });

  it('listApplications returns ok:false and empty apps without throwing', async () => {
    const ipc = makeMacOSNativeCaptureIpc(() => null, () => unavailable);
    const res = await ipc.listApplications();
    expect(res.ok).toBe(false);
    expect(res.apps).toEqual([]);
    expect(res.error).toMatch(/not built/);
  });

  it('start returns ok:false without attempting capture', async () => {
    const ipc = makeMacOSNativeCaptureIpc(() => null, () => unavailable);
    const res = await ipc.start({ pid: 123 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not built/);
  });

  it('stop returns ok:false', async () => {
    const ipc = makeMacOSNativeCaptureIpc(() => null, () => unavailable);
    const res = await ipc.stop();
    expect(res.ok).toBe(false);
  });
});

describe('makeMacOSNativeCaptureIpc — available loader', () => {
  let onAudioCb: ((s: Float32Array) => void) | null;
  let onErrorCb: ((e: { message: string; code: number }) => void) | null;
  let loader: Extract<AvailableLoader, { available: true }>;
  let provideLoader: () => AvailableLoader;

  beforeEach(() => {
    onAudioCb = null;
    onErrorCb = null;
    loader = {
      available: true,
      start: vi.fn(async (opts: StartOptions) => { onAudioCb = opts.onAudio; onErrorCb = opts.onError; }),
      stop: vi.fn(async () => {}),
      listApplications: vi.fn(async () => [
        { pid: 111, name: 'zoom.us', bundleId: 'us.zoom.xos' },
        { pid: 222, name: 'Google Chrome', bundleId: 'com.google.Chrome' },
      ]),
    };
    provideLoader = () => loader;
  });

  it('probe reports available', async () => {
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    expect(await ipc.probe()).toEqual({ available: true });
  });

  it('listApplications returns the loader apps with ok:true', async () => {
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.listApplications();
    expect(res.ok).toBe(true);
    expect(res.apps).toHaveLength(2);
    expect(res.apps[0]).toEqual({ pid: 111, name: 'zoom.us', bundleId: 'us.zoom.xos' });
  });

  it('listApplications translates a thrown error into ok:false', async () => {
    loader.listApplications = vi.fn(async () => { throw new Error('TCC declined'); });
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.listApplications();
    expect(res.ok).toBe(false);
    expect(res.apps).toEqual([]);
    expect(res.error).toMatch(/TCC declined/);
  });

  it('start forwards onAudio frames to the renderer as a sliced ArrayBuffer', async () => {
    const { win, sent } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.start({ pid: 111 });
    expect(res.ok).toBe(true);
    expect(loader.start).toHaveBeenCalledOnce();

    const frame = new Float32Array([0.1, -0.2, 0.3]);
    onAudioCb!(frame);

    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('macos-system-audio:pcm-frame');
    const payload = sent[0].payload as ArrayBuffer;
    expect(payload).toBeInstanceOf(ArrayBuffer);
    expect(new Float32Array(payload)).toEqual(frame);
  });

  it('start forwards onError to the renderer error channel', async () => {
    const { win, sent } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    await ipc.start({});
    onErrorCb!({ message: 'stream stopped', code: -3 });
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('macos-system-audio:error');
    expect(sent[0].payload).toEqual({ message: 'stream stopped', code: -3 });
  });

  it('start does not send frames after the window is destroyed', async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    let destroyed = false;
    const win = {
      isDestroyed: () => destroyed,
      webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); } },
    } as unknown as import('electron').BrowserWindow;
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    await ipc.start({});
    destroyed = true;
    onAudioCb!(new Float32Array([1, 2, 3]));
    expect(sent).toHaveLength(0);
  });

  it('start translates a thrown native error into ok:false', async () => {
    loader.start = vi.fn(async () => { throw new Error('permission denied'); });
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.start({});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/permission denied/);
  });

  it('stop delegates and reports ok:true', async () => {
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.stop();
    expect(res.ok).toBe(true);
    expect(loader.stop).toHaveBeenCalledOnce();
  });

  it('stop translates a thrown error into ok:false', async () => {
    loader.stop = vi.fn(async () => { throw new Error('stop failed'); });
    const { win } = makeFakeWindow();
    const ipc = makeMacOSNativeCaptureIpc(() => win, provideLoader);
    const res = await ipc.stop();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/stop failed/);
  });
});
