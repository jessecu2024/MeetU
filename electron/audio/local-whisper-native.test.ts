// Tests for the main-process Local Whisper IPC wrapper. We inject a
// fake smart-whisper loader, a temp userData dir, and a fake fetch, so
// the real makeLocalWhisperIpc() logic — probe, model listing,
// download-to-temp-then-rename, session start/transcribe/stop, and
// error translation — is exercised without the native addon or a
// multi-hundred-MB model.
//
// The actual whisper.cpp transcription is validated separately by a
// manual end-to-end smoke test (tiny model + a known sample WAV);
// see the PR description.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLocalWhisperIpc, type LocalWhisperLoader } from './local-whisper-native';

let tmpUserData: string;
beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'meetu-lw-'));
});
afterEach(() => {
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
});

const MODELS = {
  tiny: 'https://example.test/ggml-tiny.bin',
  base: 'https://example.test/ggml-base.bin',
};

// A fake smart-whisper Whisper instance whose transcribe returns a
// canned text, mirroring the { result: Promise<[{text}]> } shape.
function makeFakeLoader(opts: { transcribeText?: string; throwOnConstruct?: boolean } = {}): LocalWhisperLoader {
  return {
    available: true,
    module: {
      MODELS,
      Whisper: class {
        constructor(file: string) {
          if (opts.throwOnConstruct) throw new Error('model load failed');
          if (!fs.existsSync(file)) throw new Error('model file missing at construct');
        }
        async transcribe() {
          return { result: Promise.resolve([{ text: opts.transcribeText ?? 'hello world' }]) };
        }
        async free() { /* noop */ }
      } as unknown as LocalWhisperLoader extends { available: true } ? never : never,
    },
  } as unknown as LocalWhisperLoader;
}

// fetch that streams `bytes` via a real web ReadableStream (so the
// production code's Readable.fromWeb + pipeline works) with a
// content-length header.
function fakeFetch(bytes: Uint8Array, ok = true, status = 200): typeof fetch {
  return (async () => {
    const body = ok
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        })
      : null;
    return {
      ok,
      status,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(bytes.length) : null) },
      body,
    };
  }) as unknown as typeof fetch;
}

describe('makeLocalWhisperIpc — probe', () => {
  it('reports unavailable with reason when the loader is unavailable', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => ({ available: false, reason: 'not built' }));
    const res = await ipc.probe();
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/not built/);
    expect(res.models).toEqual([]);
    expect(res.hasAnyModel).toBe(false);
  });

  it('lists offered models and reports none present on a fresh dir', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader());
    const res = await ipc.probe();
    expect(res.available).toBe(true);
    expect(res.models.length).toBeGreaterThan(0);
    expect(res.hasAnyModel).toBe(false);
    // Every offered model entry carries a name + url.
    for (const m of res.models) {
      expect(typeof m.name).toBe('string');
      expect(m.url).toMatch(/^https?:\/\//);
    }
  });

  it('reports hasAnyModel:true once a model file exists', async () => {
    const dir = path.join(tmpUserData, 'whisper-models');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ggml-base.bin'), 'x'); // non-empty
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader());
    const res = await ipc.probe();
    expect(res.hasAnyModel).toBe(true);
    expect(res.models.find(m => m.name === 'base')?.present).toBe(true);
  });
});

describe('makeLocalWhisperIpc — downloadModel', () => {
  it('rejects an unknown model name (no path traversal / arbitrary fetch)', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader(), fakeFetch(new Uint8Array([1])));
    const res = await ipc.downloadModel('../../etc/passwd');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown model/);
  });

  it('downloads to a .part temp then renames to the final ggml-<name>.bin', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader(), fakeFetch(payload));
    const res = await ipc.downloadModel('tiny');
    expect(res.ok).toBe(true);
    const final = path.join(tmpUserData, 'whisper-models', 'ggml-tiny.bin');
    expect(fs.existsSync(final)).toBe(true);
    expect(fs.readFileSync(final)).toEqual(Buffer.from(payload));
    // No leftover .part file.
    expect(fs.existsSync(final + '.part')).toBe(false);
  });

  it('returns ok:false on HTTP error and leaves no partial file', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader(), fakeFetch(new Uint8Array(), false, 404));
    const res = await ipc.downloadModel('tiny');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/404/);
    expect(fs.existsSync(path.join(tmpUserData, 'whisper-models', 'ggml-tiny.bin'))).toBe(false);
  });

  it('pushes download-progress events to the window', async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const win = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as unknown as import('electron').BrowserWindow;
    const ipc = makeLocalWhisperIpc(() => win, () => tmpUserData, () => makeFakeLoader(), fakeFetch(new Uint8Array([1, 2, 3])));
    await ipc.downloadModel('tiny');
    const progress = sent.filter(s => s.channel === 'local-whisper:download-progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)!.payload).toMatchObject({ model: 'tiny' });
  });
});

describe('makeLocalWhisperIpc — session', () => {
  it('start fails clearly when the model is not downloaded', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader());
    const res = await ipc.start({ model: 'base' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not downloaded/);
  });

  it('start rejects an invalid model name', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader());
    const res = await ipc.start({ model: 'bogus' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid or missing model/);
  });

  it('start loads a present model, transcribe returns text, stop frees', async () => {
    const dir = path.join(tmpUserData, 'whisper-models');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ggml-base.bin'), 'fake-model-bytes');
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader({ transcribeText: 'meeting notes' }));

    expect(await ipc.start({ model: 'base' })).toEqual({ ok: true });
    const pcm = new Float32Array([0.1, 0.2, 0.3]).buffer;
    const t = await ipc.transcribe(pcm, { language: 'en' });
    expect(t.ok).toBe(true);
    expect(t.text).toBe('meeting notes');
    expect(await ipc.stop()).toEqual({ ok: true });
  });

  it('transcribe before start returns ok:false', async () => {
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader());
    const res = await ipc.transcribe(new Float32Array([0]).buffer, {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no active whisper session/);
  });

  it('start translates a model-load throw into ok:false', async () => {
    const dir = path.join(tmpUserData, 'whisper-models');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ggml-base.bin'), 'x');
    const ipc = makeLocalWhisperIpc(() => null, () => tmpUserData, () => makeFakeLoader({ throwOnConstruct: true }));
    const res = await ipc.start({ model: 'base' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/model load failed/);
  });
});
