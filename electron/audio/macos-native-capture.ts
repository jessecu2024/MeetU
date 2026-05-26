// ============================================================
// Main-process wrapper around the macOS ScreenCaptureKit native
// module. Lives in the main process because:
//
//   1. The native addon is a node-gyp .node file — Electron's
//      renderer is a Chromium sandbox where loading arbitrary
//      native modules is disallowed.
//   2. SCStream's callbacks fire on a Mach-scheduled queue
//      inside the addon; we ship PCM frames to the renderer
//      via webContents.send() rather than crossing the
//      sandbox boundary with raw native handles.
//
// Exposes three IPC channels (registered from electron/main.ts):
//
//   macos-system-audio:list-apps   -> ApplicationEntry[]
//   macos-system-audio:start       -> { ok: true } | { ok: false, error }
//   macos-system-audio:stop        -> { ok: true }
//
// And one push channel:
//
//   macos-system-audio:pcm-frame   ArrayBuffer (Float32 16-kHz mono)
//   macos-system-audio:error       { message, code }
// ============================================================

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';
import type { AvailableLoader, ApplicationEntry, StartOptions } from '../../native/macos';

// vite-plugin-electron bundles this file to CJS, so __dirname is
// available there. In ESM tests we synthesise it from
// import.meta.url. createRequire then resolves the addon loader by
// absolute path.
let dirname: string;
try {
  dirname = __dirname; // CJS bundle path
} catch {
  dirname = path.dirname(fileURLToPath(import.meta.url));
}
const requireFromHere = createRequire(path.join(dirname, '__virtual__.cjs'));

// The native loader lives at <project-root>/native/macos/index.cjs.
// The relative depth from this file's runtime location DIFFERS by
// environment:
//   - dev:        electron/audio/macos-native-capture.ts -> ../../native/macos
//   - bundled:    dist-electron/main.js                  -> ../native/macos
//   - packaged:   resources/app.asar.unpacked/...        -> via resourcesPath
// Rather than guess one depth, we probe a list of candidate roots
// and use the first that actually contains index.cjs. This keeps the
// loader correct across dev, the vite-electron bundle, and a packaged
// electron-builder app (where native/ must be added via
// extraResources / asarUnpack).
function resolveNativeLoaderPath(): string | null {
  const candidates = [
    path.join(dirname, '..', '..', 'native', 'macos', 'index.cjs'), // dev: electron/audio
    path.join(dirname, '..', 'native', 'macos', 'index.cjs'),        // bundled: dist-electron
    path.join(process.cwd(), 'native', 'macos', 'index.cjs'),        // cwd fallback (dev)
  ];
  // Packaged-app location (process.resourcesPath only exists in a
  // real Electron runtime, not in plain-node tests).
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, 'app.asar.unpacked', 'native', 'macos', 'index.cjs'),
      path.join(resourcesPath, 'native', 'macos', 'index.cjs'),
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* keep probing */ }
  }
  return null;
}

// The loader returns an `AvailableLoader` union — either the real
// native API or an `{ available: false, reason }` shape.
function loadNative(): AvailableLoader {
  const loaderPath = resolveNativeLoaderPath();
  if (!loaderPath) {
    return {
      available: false,
      reason: 'native/macos/index.cjs not found in any known location (dev, dist-electron bundle, or packaged resources)',
    };
  }
  try {
    return requireFromHere(loaderPath) as AvailableLoader;
  } catch (err) {
    return {
      available: false,
      reason: `Failed to require macOS native loader at ${loaderPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

let cachedLoader: AvailableLoader | null = null;

/**
 * Get the (cached) native loader. Cheap to call repeatedly —
 * the loader-side require() is idempotent because Node caches
 * the .node import, and the loader itself returns the same
 * object on every call.
 */
export function getMacOSNativeCapture(): AvailableLoader {
  if (cachedLoader === null) {
    cachedLoader = loadNative();
  }
  return cachedLoader;
}

/**
 * Reset the cached loader. Used by tests to inject a mocked
 * shape; do not call from production code.
 */
export function __resetMacOSNativeCaptureForTest(): void {
  cachedLoader = null;
}

/**
 * Build the IPC handler closures over a getter for the live
 * BrowserWindow. The getter is captured (not the window itself)
 * so a window-recreate-after-close flow still ships frames to
 * the latest window. The handlers return JSON-serialisable
 * shapes only — the actual Float32 PCM goes through
 * `mainWindow.webContents.send('macos-system-audio:pcm-frame', ...)`.
 */
export function makeMacOSNativeCaptureIpc(
  getWindow: () => BrowserWindow | null,
  // Loader injection point — defaults to the cached real loader.
  // Tests pass a fake { available:true, start/stop/listApplications }
  // so they exercise THIS production glue rather than a copy.
  loaderProvider: () => AvailableLoader = getMacOSNativeCapture,
) {
  return {
    /** Probe whether the native module is loadable and ready. */
    async probe(): Promise<{ available: boolean; reason?: string }> {
      const loader = loaderProvider();
      return loader.available
        ? { available: true }
        : { available: false, reason: loader.reason };
    },

    /** List capturable applications. Returns [] on failure. */
    async listApplications(): Promise<{ ok: boolean; apps: ApplicationEntry[]; error?: string }> {
      const loader = loaderProvider();
      if (!loader.available) {
        return { ok: false, apps: [], error: loader.reason };
      }
      try {
        const apps = await loader.listApplications();
        return { ok: true, apps };
      } catch (err) {
        return { ok: false, apps: [], error: err instanceof Error ? err.message : String(err) };
      }
    },

    /**
     * Start capturing. `pid` is optional — when omitted, captures
     * the full system mix; when set, captures only audio that
     * the target app produced (per ScreenCaptureKit's
     * `initWithDisplay:includingApplications:`). The audio path:
     * native callback -> this onAudio closure -> IPC send to
     * renderer -> capture.ts subscriber.
     */
    async start(opts: { pid?: number }): Promise<{ ok: boolean; error?: string }> {
      const loader = loaderProvider();
      if (!loader.available) {
        return { ok: false, error: loader.reason };
      }

      const startOpts: StartOptions = {
        pid: opts.pid,
        onAudio: (samples) => {
          const win = getWindow();
          if (!win || win.isDestroyed()) return;
          // ArrayBuffer is transferable; Electron's webContents.send
          // structured-clones it across the renderer boundary. Slice
          // ensures we send exactly the bytes the Float32Array views,
          // not the surrounding buffer.
          const ab = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
          win.webContents.send('macos-system-audio:pcm-frame', ab);
        },
        onError: (err) => {
          const win = getWindow();
          if (!win || win.isDestroyed()) return;
          win.webContents.send('macos-system-audio:error', err);
        },
      };

      try {
        await loader.start(startOpts);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    /** Tear down. Safe to call when not running. */
    async stop(): Promise<{ ok: boolean; error?: string }> {
      const loader = loaderProvider();
      if (!loader.available) {
        return { ok: false, error: loader.reason };
      }
      try {
        await loader.stop();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
