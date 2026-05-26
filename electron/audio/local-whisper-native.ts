// ============================================================
// Main-process wrapper around `smart-whisper` (whisper.cpp N-API
// binding, MIT). Runs in the main process because:
//   - smart-whisper is a native node addon (renderer is sandboxed).
//   - whisper.cpp wants 16-kHz mono Float32 PCM — exactly what our
//     capture `pcm-stream` mode already produces — so the renderer
//     engine accumulates ~10-15 s windows and ships each over IPC to
//     here for transcription.
//
// Responsibilities:
//   1. Tolerant load of smart-whisper (optionalDependency — a failed
//      whisper.cpp build must not break the app; we just report
//      unavailable and the engine stays unselectable / falls back).
//   2. Model management: a models dir under userData, listing which
//      ggml models are present, and downloading one from the
//      HuggingFace ggml repo with progress events.
//   3. A transcription session: load a model once on start, transcribe
//      each PCM window, free on stop.
//
// IPC (registered + frame-guarded in electron/main.ts):
//   local-whisper:probe            -> { available, reason?, models, hasAnyModel }
//   local-whisper:download-model   -> { ok, error? }   (+ progress pushes)
//   local-whisper:start            -> { ok, error? }
//   local-whisper:transcribe       -> { ok, text?, error? }
//   local-whisper:stop             -> { ok }
//   push: local-whisper:download-progress { model, receivedBytes, totalBytes }
// ============================================================

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';

// Hard cap on a single transcribe window. The renderer submits ~12 s
// windows (16 kHz Float32 = 768 KB), but a buggy/compromised caller
// could send an arbitrarily large buffer straight into native
// inference. Reject anything over 60 s of audio.
const MAX_TRANSCRIBE_SAMPLES = 16000 * 60;
// Whisper language codes are short ascii tokens (e.g. "en", "zh") or
// "auto". Sanitize to that shape so opts.language can't smuggle
// anything odd into the native params.
const LANGUAGE_RE = /^[a-z]{2,5}(-[a-z]{2,5})?$/i;

// smart-whisper's public surface (subset we use). Typed loosely
// because the package is an optionalDependency that may be absent.
interface SmartWhisperModule {
  Whisper: new (file: string, config?: { gpu?: boolean; offload?: number }) => SmartWhisperInstance;
  MODELS: Record<string, string>;
}
interface SmartWhisperInstance {
  transcribe(pcm: Float32Array, params?: Record<string, unknown>): Promise<{ result: Promise<Array<{ text: string }>> }>;
  free(): Promise<void>;
}

export type LocalWhisperLoader =
  | { available: true; module: SmartWhisperModule }
  | { available: false; reason: string };

let dirname: string;
try {
  dirname = __dirname;
} catch {
  dirname = path.dirname(fileURLToPath(import.meta.url));
}
const requireFromHere = createRequire(path.join(dirname, '__virtual__.cjs'));

let cachedLoader: LocalWhisperLoader | null = null;

function loadSmartWhisper(): LocalWhisperLoader {
  try {
    const mod = requireFromHere('smart-whisper') as SmartWhisperModule;
    if (!mod || typeof mod.Whisper !== 'function') {
      return { available: false, reason: 'smart-whisper loaded but Whisper export is missing' };
    }
    return { available: true, module: mod };
  } catch (err) {
    return {
      available: false,
      reason:
        `smart-whisper is not available: ${err instanceof Error ? err.message : String(err)}. ` +
        `It is an optional dependency; reinstall with build tools (Xcode CLT / build-essential) to enable offline Whisper, ` +
        `or use an online STT engine.`,
    };
  }
}

export function getLocalWhisper(): LocalWhisperLoader {
  if (cachedLoader === null) cachedLoader = loadSmartWhisper();
  return cachedLoader;
}

/** Test seam: inject a fake loader so the IPC wrapper can be unit-tested. */
export function __setLocalWhisperLoaderForTest(loader: LocalWhisperLoader | null): void {
  cachedLoader = loader;
}

// ── Model management ─────────────────────────────────────────

export interface ModelEntry {
  name: string;
  present: boolean;
  url: string;
  sizeBytes?: number;
}

/** Models we surface in the UI — a sensible subset of smart-whisper's MODELS. */
const OFFERED_MODELS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en'] as const;

function modelsDir(getUserDataPath: () => string): string {
  return path.join(getUserDataPath(), 'whisper-models');
}

function modelFilePath(dir: string, name: string): string {
  // ggml model filenames are `ggml-<name>.bin`. `name` is constrained
  // to OFFERED_MODELS so it cannot contain path separators.
  return path.join(dir, `ggml-${name}.bin`);
}

function listModels(loader: LocalWhisperLoader, dir: string): ModelEntry[] {
  if (!loader.available) return [];
  const urls = loader.module.MODELS;
  const entries: ModelEntry[] = [];
  for (const name of OFFERED_MODELS) {
    const url = urls[name];
    if (!url) continue;
    const file = modelFilePath(dir, name);
    let sizeBytes: number | undefined;
    let present = false;
    try {
      const st = fs.statSync(file);
      present = st.isFile() && st.size > 0;
      sizeBytes = st.size;
    } catch { /* not present */ }
    entries.push({ name, present, url, sizeBytes });
  }
  return entries;
}

/**
 * Build the IPC handler closures. `getUserDataPath` and `getWindow`
 * are injected (not the live values) so a window rebuild still pushes
 * progress to the latest window, and so tests can supply temp dirs.
 * `fetchImpl` defaults to global fetch (Electron/Node 18+), injectable
 * for tests.
 */
export function makeLocalWhisperIpc(
  getWindow: () => BrowserWindow | null,
  getUserDataPath: () => string,
  loaderProvider: () => LocalWhisperLoader = getLocalWhisper,
  fetchImpl: typeof fetch = fetch,
) {
  // The single active model instance for the current session. whisper
  // model loads are heavy (hundreds of MB), so we keep one loaded for
  // the whole session and free it on stop.
  let active: SmartWhisperInstance | null = null;
  // Guards against overlapping downloads of the same model.
  const downloading = new Set<string>();

  // Serialize ALL session operations (start / transcribe / stop) onto a
  // single promise chain. whisper.cpp's model context is not safe for
  // concurrent use, and — critically — without serialization a stop()
  // or a second start() could free() the model instance while a
  // transcribe() is still running native inference on it (use-after-
  // free / crash). Running each op exclusively guarantees: a transcribe
  // captured `active` at the moment it runs (so it can't see a freed
  // instance), and free() in stop/start only runs once no transcribe is
  // in flight.
  let opChain: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = opChain.then(fn, fn);
    // Keep the chain alive regardless of this op's outcome.
    opChain = run.then(() => undefined, () => undefined);
    return run;
  }

  function dir(): string {
    const d = modelsDir(getUserDataPath);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // Free the active instance (if any). Caller MUST hold the op chain
  // (i.e. call from inside runExclusive) so no transcribe is in flight.
  async function freeActiveLocked(): Promise<void> {
    if (active) {
      const inst = active;
      active = null;
      try { await inst.free(); } catch { /* ignore */ }
    }
  }

  return {
    async probe(): Promise<{ available: boolean; reason?: string; models: ModelEntry[]; hasAnyModel: boolean }> {
      const loader = loaderProvider();
      if (!loader.available) {
        return { available: false, reason: loader.reason, models: [], hasAnyModel: false };
      }
      const models = listModels(loader, dir());
      return { available: true, models, hasAnyModel: models.some(m => m.present) };
    },

    /** Download a ggml model to the models dir, streaming progress. */
    async downloadModel(name: string): Promise<{ ok: boolean; error?: string }> {
      const loader = loaderProvider();
      if (!loader.available) return { ok: false, error: loader.reason };
      if (!(OFFERED_MODELS as readonly string[]).includes(name)) {
        return { ok: false, error: `unknown model: ${name}` };
      }
      const url = loader.module.MODELS[name];
      if (!url) return { ok: false, error: `no download URL for model: ${name}` };
      if (downloading.has(name)) return { ok: false, error: `already downloading ${name}` };

      downloading.add(name);
      const destDir = dir();
      const finalPath = modelFilePath(destDir, name);
      // Download to a temp file and rename on success, so an aborted
      // download never leaves a truncated file that looks "present".
      const tmpPath = `${finalPath}.part`;
      try {
        const res = await fetchImpl(url);
        if (!res.ok || !res.body) {
          return { ok: false, error: `download failed: HTTP ${res.status}` };
        }
        const totalBytes = Number(res.headers.get('content-length') || 0);
        let receivedBytes = 0;
        let lastEmit = 0;
        // A counting passthrough so we can report progress while
        // `pipeline` owns backpressure + error propagation + stream
        // teardown. The previous hand-rolled `out.write()` loop ignored
        // write-stream errors (ENOSPC/EACCES surface asynchronously on
        // the stream, not from write()), which could crash the main
        // process or resolve as success on a partial file.
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            receivedBytes += chunk.length;
            const now = Date.now();
            if (now - lastEmit > 250) { // throttle to ~4/sec
              lastEmit = now;
              const win = getWindow();
              if (win && !win.isDestroyed()) {
                win.webContents.send('local-whisper:download-progress', { model: name, receivedBytes, totalBytes });
              }
            }
            cb(null, chunk);
          },
        });
        // pipeline rejects (and destroys all streams) on any error from
        // the source, the counter, or the file write — including async
        // backpressure/disk errors — so the catch below always runs.
        await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), counter, fs.createWriteStream(tmpPath));
        fs.renameSync(tmpPath, finalPath);
        // Final 100% progress tick.
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('local-whisper:download-progress', { model: name, receivedBytes, totalBytes: totalBytes || receivedBytes });
        }
        return { ok: true };
      } catch (err) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        downloading.delete(name);
      }
    },

    /** Load a model for a transcription session. */
    async start(opts: { model: string }): Promise<{ ok: boolean; error?: string }> {
      const loader = loaderProvider();
      if (!loader.available) return { ok: false, error: loader.reason };
      const name = opts?.model;
      if (!name || !(OFFERED_MODELS as readonly string[]).includes(name)) {
        return { ok: false, error: `invalid or missing model: ${name}` };
      }
      const file = modelFilePath(dir(), name);
      if (!fs.existsSync(file)) {
        return { ok: false, error: `model not downloaded: ${name}. Download it in Settings first.` };
      }
      // Exclusive: frees any prior instance (after its transcribes
      // drain) before loading the new one.
      return runExclusive(async () => {
        await freeActiveLocked();
        try {
          active = new loader.module.Whisper(file, { gpu: true, offload: 300 });
          return { ok: true };
        } catch (err) {
          active = null;
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    },

    /** Transcribe one 16-kHz mono Float32 PCM window. */
    async transcribe(pcm: unknown, opts: { language?: string }): Promise<{ ok: boolean; text?: string; error?: string }> {
      // Argument validation — this feeds native inference, so reject
      // anything that isn't a sane Float32 PCM window before it gets
      // there. (The renderer is trusted-ish, but a bug shouldn't be
      // able to push a detached/huge/misaligned buffer into whisper.)
      if (!(pcm instanceof ArrayBuffer)) return { ok: false, error: 'transcribe: pcm must be an ArrayBuffer' };
      if (pcm.byteLength === 0) return { ok: false, error: 'transcribe: empty pcm' };
      if (pcm.byteLength % 4 !== 0) return { ok: false, error: 'transcribe: pcm byte length not Float32-aligned' };
      if (pcm.byteLength / 4 > MAX_TRANSCRIBE_SAMPLES) return { ok: false, error: 'transcribe: window too large' };
      const language = opts?.language && LANGUAGE_RE.test(opts.language) ? opts.language : 'auto';
      const samples = new Float32Array(pcm);

      return runExclusive(async () => {
        // Capture under the lock: if a stop()/start() ran first, active
        // is null (or the new instance) — never a freed one.
        const inst = active;
        if (!inst) return { ok: false, error: 'no active whisper session' };
        try {
          const task = await inst.transcribe(samples, {
            language,
            n_threads: Math.max(2, Math.min(8, (os.cpus()?.length || 4) - 1)),
            no_timestamps: true,
            single_segment: false,
            suppress_blank: true,
            suppress_non_speech_tokens: true,
          });
          const results = await task.result;
          const text = results.map(r => r.text).join(' ').trim();
          return { ok: true, text };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
    },

    /** Free the model instance. Safe to call when nothing is loaded. */
    async stop(): Promise<{ ok: boolean }> {
      // Exclusive: waits for any in-flight transcribe to finish before
      // freeing, so we never free() a model under active inference.
      return runExclusive(async () => {
        await freeActiveLocked();
        return { ok: true };
      });
    },
  };
}
