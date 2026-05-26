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
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';

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

  function dir(): string {
    const d = modelsDir(getUserDataPath);
    fs.mkdirSync(d, { recursive: true });
    return d;
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
        const out = fs.createWriteStream(tmpPath);
        const reader = res.body.getReader();
        let lastEmit = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.write(Buffer.from(value));
          receivedBytes += value.byteLength;
          // Throttle progress pushes to ~4/sec to avoid flooding IPC.
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            const win = getWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('local-whisper:download-progress', { model: name, receivedBytes, totalBytes });
            }
          }
        }
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => err ? reject(err) : resolve()));
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
      try {
        // Free any prior instance (defensive — stop() should have).
        if (active) { try { await active.free(); } catch { /* ignore */ } active = null; }
        active = new loader.module.Whisper(file, { gpu: true, offload: 300 });
        return { ok: true };
      } catch (err) {
        active = null;
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /** Transcribe one 16-kHz mono Float32 PCM window. */
    async transcribe(pcm: ArrayBuffer, opts: { language?: string }): Promise<{ ok: boolean; text?: string; error?: string }> {
      if (!active) return { ok: false, error: 'no active whisper session' };
      try {
        const samples = new Float32Array(pcm);
        const task = await active.transcribe(samples, {
          language: opts?.language || 'auto',
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
    },

    /** Free the model instance. Safe to call when nothing is loaded. */
    async stop(): Promise<{ ok: boolean }> {
      if (active) {
        try { await active.free(); } catch { /* ignore */ }
        active = null;
      }
      return { ok: true };
    },
  };
}
