// ============================================================
// Electron Main Process
// Creates floating window, registers IPC handlers, manages lifecycle
// ============================================================

import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, shell, desktopCapturer } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSetting, setSetting } from './store';
import {
  startRecording, stopRecording, appendChunk,
  isRecording as isFileRecording, getRecordingsPath
} from './audio/file-manager';
import { initDatabase, runQuery } from './database';
import { renderMinutesDocx } from './export/docx-generator';
import { renderMinutesPdf } from './export/pdf-generator';
import { sanitizeFilenameForExport } from './export/sanitize-filename';
import { probeSystemAudioSupport } from './system-audio-probe';
import { getMacOSNativeCapture, makeMacOSNativeCaptureIpc } from './audio/macos-native-capture';
import { makeLocalWhisperIpc } from './audio/local-whisper-native';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

// What the renderer is allowed to run at. Set in createWindow and
// consulted by both the navigation lockdown and the trusted-IPC frame
// check, so a top frame navigated off-origin (we block it, but defense
// in depth) cannot invoke privileged native-audio IPC.
//
// Dev:  exact dev-server origin (e.g. http://localhost:5173).
// Prod: a file:// prefix scoped to the bundled `dist/` directory — NOT
//       all of file://. Trusting any local file URL would let a top
//       frame navigated to some other on-disk HTML reach the privileged
//       channels.
let trustedDevOrigin: string | null = null;
let trustedFilePrefix: string | null = null;
function isTrustedAppUrl(url: string): boolean {
  if (!url) return false;
  if (trustedDevOrigin) {
    try { return new URL(url).origin === trustedDevOrigin; } catch { return false; }
  }
  if (trustedFilePrefix) {
    return url.startsWith(trustedFilePrefix);
  }
  return false;
}

/** Create main window (floating mode) */
function createWindow(): void {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 450,
    height: 750,
    x: screenW - 470,
    y: 80,
    title: 'MeetU',
    icon: path.join(__dirname, '../resources/icons/icon.png'),
    frame: true,
    transparent: false,
    alwaysOnTop: false,
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // preload.cjs is a plain CommonJS file copied directly (not built by vite-plugin-electron)
      // This avoids the ESM/CJS format issue with package.json "type":"module"
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
  const prodIndexPath = path.join(__dirname, '../dist/index.html');
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(prodIndexPath);
  }

  // ── Navigation lockdown (security hardening) ──
  // The macOS native + Windows loopback IPC handlers trust the
  // mainWindow's top frame. That trust is only safe if the top frame
  // can never be navigated to attacker-controlled content. So:
  //   1. Deny all window.open / target=_blank popups (open externally).
  //   2. Block in-page navigation away from our own app origin; any
  //      external link goes to the user's browser via shell.openExternal.
  // The trusted origin is the dev server URL in dev, or file:// in prod.
  if (VITE_DEV_SERVER_URL) {
    trustedDevOrigin = new URL(VITE_DEV_SERVER_URL).origin;
    trustedFilePrefix = null;
  } else {
    trustedDevOrigin = null;
    // Scope trust to the bundled dist/ directory file-URL prefix, so
    // only our own packaged HTML (not arbitrary on-disk files) counts
    // as the app origin.
    trustedFilePrefix = pathToFileURL(path.join(__dirname, '../dist/')).href;
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) { void shell.openExternal(url); }
    return { action: 'deny' };
  });
  const blockOffOriginNav = (event: Electron.Event, url: string) => {
    if (!isTrustedAppUrl(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) { void shell.openExternal(url); }
    }
  };
  // Cover both user/script navigations AND server/meta redirects, so a
  // redirect can't sneak the top frame off the app origin.
  mainWindow.webContents.on('will-navigate', blockOffOriginNav);
  mainWindow.webContents.on('will-redirect', blockOffOriginNav);

  // Forward renderer console logs to main process terminal for debugging
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('[Audio]') || message.startsWith('[STT]') || message.includes('FAIL') || message.includes('getUserMedia')) {
      console.log(`[Renderer] ${message}`);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── Grant all permissions (desktop app — no need for browser-style restrictions) ──
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    console.log(`[Main] Permission granted: ${permission}`);
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler(() => {
    return true;
  });

  // ── Bypass CORS for AI API endpoints ──
  // Desktop apps don't need CORS restrictions; AI providers don't set CORS headers for browser origins
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url;
    const isAiApi =
      url.includes('api.anthropic.com') ||
      url.includes('api.openai.com') ||
      url.includes('generativelanguage.googleapis.com') ||
      url.includes('api.deepseek.com') ||
      url.includes('dashscope.aliyuncs.com') ||
      url.includes('api.minimax.chat') ||
      url.includes('open.bigmodel.cn');

    if (isAiApi) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'access-control-allow-origin': ['*'],
          'access-control-allow-headers': ['*'],
          'access-control-allow-methods': ['POST, GET, OPTIONS, PUT, DELETE'],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });
}

/**
 * Register the global session handler that lets the renderer call
 * `navigator.mediaDevices.getDisplayMedia({audio:true, ...})` and
 * receive system-audio loopback. Without this, Electron rejects every
 * such call with `NotSupportedError`.
 *
 * Defense-in-depth:
 *
 *   - Reject every request that does not originate from the trusted
 *     main frame of the mainWindow. Embedded iframes, popup windows,
 *     and any future webview content must not be able to silently
 *     receive a screen capture by issuing `getDisplayMedia`.
 *   - Reject requests that do not ask for audio (the renderer's
 *     only legitimate use of this API is the system-audio loopback
 *     path; a stray request that wants only video should not be
 *     handed the primary screen on the user's behalf).
 *   - Only return `audio:'loopback'` on platforms where Electron
 *     supports it (Windows). On other platforms we still reject so
 *     a future MeetU UI bug that calls `getDisplayMedia` outside of
 *     the system-audio button cannot silently leak the screen.
 *
 * Lives in its own function (not inside `createWindow`) because it
 * mutates the default Session — global state configured exactly once
 * during `app.whenReady`.
 */
function registerDisplayMediaHandler(): void {
  // Bypass-shape for `callback({})` — the typedef expects a Streams
  // object with optional `video`/`audio`, and passing `{}` tells
  // Electron to reject the request. The signature parameter typing
  // here is a workaround for the strict overload.
  const denyShape = {} as { video?: never; audio?: never };

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      // 1) Authenticate the requester. Only the trusted main frame
      //    (top-level WebFrameMain of the BrowserWindow we created)
      //    is allowed to ask for system audio. A future iframe /
      //    webview / popup would have a different `frame` and
      //    different `securityOrigin`, so we reject the request
      //    rather than handing out the primary screen.
      const win = mainWindow;
      const requestFrameId = request.frame?.frameTreeNodeId;
      const trustedFrameId = win?.webContents?.mainFrame?.frameTreeNodeId;
      const isMainFrame = !!win && !win.isDestroyed() && requestFrameId !== undefined && requestFrameId === trustedFrameId;
      // Belt-and-suspenders, matching the macOS native IPC check: the
      // top frame must also be on our own app origin. Navigation
      // lockdown already prevents the top frame leaving the app origin,
      // but re-checking here means a redirect / lockdown regression
      // can't turn an off-origin top frame into a screen-capture grant.
      const isTrustedFrameUrl = !!request.frame && isTrustedAppUrl(request.frame.url);
      if (!isMainFrame || !isTrustedFrameUrl) {
        console.warn(
          `[Display] Rejected getDisplayMedia from untrusted frame`,
          { origin: request.securityOrigin, url: request.frame?.url, audioRequested: request.audioRequested, videoRequested: request.videoRequested },
        );
        callback(denyShape);
        return;
      }

      // 2) We only serve loopback audio requests. A request that
      //    wants only video has no legitimate use case in MeetU and
      //    is more likely a bug or an attempt to bypass the device
      //    selector. Reject so the screen does not leak.
      if (!request.audioRequested) {
        console.warn('[Display] Rejected getDisplayMedia: audio not requested');
        callback(denyShape);
        return;
      }

      // 3) Only return loopback on platforms where Electron's typedef
      //    documents support. On macOS/Linux Electron 30 returns
      //    Windows-only support; allowing it here would either be a
      //    no-op (Electron rejects internally) or, worse, hand out
      //    the primary screen with a silent audio track.
      if (process.platform !== 'win32') {
        console.warn(
          `[Display] Rejected getDisplayMedia: audio:'loopback' is Windows-only on Electron ${process.versions.electron}; platform=${process.platform}`,
        );
        callback(denyShape);
        return;
      }

      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length === 0) {
          console.error('[Display] No screen sources available for loopback');
          callback(denyShape);
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      } catch (err) {
        console.error('[Display] setDisplayMediaRequestHandler failed:', err);
        callback(denyShape);
      }
    },
  );
}

/** Register global shortcuts */
function registerShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('shortcut:toggle-recording');
  });

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

/** Register IPC handlers */
function registerIPC(): void {
  // ── Settings (encrypted store) ──
  ipcMain.handle('settings:get', async (_event, key: string) => {
    try {
      return getSetting(key);
    } catch (err) {
      console.error('[Main] settings:get error:', err);
      return null;
    }
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    try {
      setSetting(key, value);
    } catch (err) {
      console.error('[Main] settings:set error:', err);
    }
  });

  // ── Audio: Recording File Management ──
  ipcMain.handle('audio:start-recording', async () => {
    const filePath = startRecording();
    console.log('[Main] Recording file started:', filePath);
    return filePath;
  });

  ipcMain.handle('audio:stop-recording', async () => {
    const filePath = stopRecording();
    console.log('[Main] Recording file saved:', filePath);
    return filePath;
  });

  ipcMain.handle('audio:append-chunk', async (_event, data: ArrayBuffer) => {
    appendChunk(data);
  });

  ipcMain.handle('audio:is-recording', async () => {
    return isFileRecording();
  });

  ipcMain.handle('audio:get-recordings-path', async () => {
    return getRecordingsPath();
  });

  // ── Audio: Legacy ──
  ipcMain.handle('audio:get-devices', async () => {
    return [];
  });

  // ── System audio loopback: support probe ──
  // The renderer calls this before offering the "System Audio" device
  // option, so users on unsupported platforms (everything except
  // Windows 10+ today) see an explanation instead of a silent failure
  // when they try to record. Backed by Electron's getDisplayMedia +
  // setDisplayMediaRequestHandler path. Per Electron 30's typedef,
  // audio:'loopback' is "currently only supported on Windows" (it
  // wraps WASAPI loopback). macOS native system-audio capture via
  // ScreenCaptureKit is on the roadmap and ships through a native
  // N-API module (PR #4b) rather than this Electron wrapper path.
  ipcMain.handle('system-audio:probe', async () => {
    // On darwin we read the Screen Recording permission state and
    // probe the native ScreenCaptureKit addon. The probe function
    // selects the backend:
    //   - win32  -> 'electron-loopback' (getDisplayMedia)
    //   - darwin -> 'macos-native' when the addon loaded, else
    //               unsupported with an actionable reason
    let screenPermission: string | undefined;
    let macOSNativeAvailable: boolean | undefined;
    let macOSNativeReason: string | undefined;
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = await import('electron');
        screenPermission = systemPreferences.getMediaAccessStatus('screen');
      } catch { /* legacy macOS without that API */ }
      const native = getMacOSNativeCapture();
      macOSNativeAvailable = native.available;
      macOSNativeReason = native.available ? undefined : native.reason;
    }
    return probeSystemAudioSupport({
      platform: process.platform,
      // Electron augments NodeJS.Process with getSystemVersion(); on
      // macOS it returns the real OS version (e.g. "13.4.0"), unlike
      // os.release() which returns the Darwin kernel version.
      macOsVersion: process.platform === 'darwin' ? process.getSystemVersion() : undefined,
      winRelease: process.platform === 'win32' ? os.release() : undefined,
      screenPermission,
      macOSNativeAvailable,
      macOSNativeReason,
    });
  });

  // ── macOS native ScreenCaptureKit capture (PR #4b) ──
  // These channels start ScreenCaptureKit (which can trigger the TCC
  // permission prompt and capture system audio), so they get the same
  // main-frame hardening as the Windows setDisplayMediaRequestHandler:
  // a request from any iframe / webview / popup is rejected. Without
  // this, embedded or compromised content reaching ipcRenderer could
  // enumerate running apps or start system-audio capture. PCM frames
  // are pushed back on 'macos-system-audio:pcm-frame'.
  const macNativeIpc = makeMacOSNativeCaptureIpc(() => mainWindow);
  // Returns true only when the request originates from the trusted
  // top-level frame of our own window, on our own app origin. Used to
  // gate every privileged audio channel (macOS native capture AND
  // local-whisper, which can read files / spawn heavy native work).
  const isTrustedRequest = (event: Electron.IpcMainInvokeEvent): boolean => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return false;
    const trusted = win.webContents.mainFrame;
    const sender = event.senderFrame;
    if (!sender) return false;
    // (1) Must be the top-level frame of our window (not an iframe/
    //     webview/popup), AND (2) that frame must be on our own app
    //     origin. (2) is belt-and-suspenders: will-navigate already
    //     blocks the top frame from leaving the app origin, but we
    //     re-check here so privileged native-audio IPC can never be
    //     reached from off-origin content even if navigation lockdown
    //     regresses.
    return sender.frameTreeNodeId === trusted.frameTreeNodeId
      && isTrustedAppUrl(sender.url);
  };
  ipcMain.handle('macos-system-audio:list-apps', (event) => {
    if (!isTrustedRequest(event)) {
      console.warn('[Main] Rejected macos-system-audio:list-apps from untrusted frame');
      return { ok: false, apps: [], error: 'rejected: untrusted frame' };
    }
    return macNativeIpc.listApplications();
  });
  ipcMain.handle('macos-system-audio:start', (event, opts: { pid?: number }) => {
    if (!isTrustedRequest(event)) {
      console.warn('[Main] Rejected macos-system-audio:start from untrusted frame');
      return { ok: false, error: 'rejected: untrusted frame' };
    }
    // Validate the pid argument shape — only a non-negative integer is
    // meaningful (0/undefined = whole system).
    const pid = typeof opts?.pid === 'number' && Number.isInteger(opts.pid) && opts.pid > 0 ? opts.pid : undefined;
    return macNativeIpc.start({ pid });
  });
  ipcMain.handle('macos-system-audio:stop', (event) => {
    if (!isTrustedRequest(event)) {
      console.warn('[Main] Rejected macos-system-audio:stop from untrusted frame');
      return { ok: false, error: 'rejected: untrusted frame' };
    }
    return macNativeIpc.stop();
  });

  // ── Local Whisper (offline, smart-whisper / whisper.cpp) ──
  // Same trusted-frame gating: download-model fetches hundreds of MB
  // and transcribe runs heavy native work; neither should be reachable
  // from untrusted content. Model files live under userData.
  const localWhisperIpc = makeLocalWhisperIpc(() => mainWindow, () => app.getPath('userData'));
  ipcMain.handle('local-whisper:probe', (event) => {
    if (!isTrustedRequest(event)) return { available: false, reason: 'rejected: untrusted frame', models: [], hasAnyModel: false };
    return localWhisperIpc.probe();
  });
  ipcMain.handle('local-whisper:download-model', (event, name: string) => {
    if (!isTrustedRequest(event)) return { ok: false, error: 'rejected: untrusted frame' };
    return localWhisperIpc.downloadModel(String(name));
  });
  ipcMain.handle('local-whisper:delete-model', (event, name: string) => {
    if (!isTrustedRequest(event)) return { ok: false, error: 'rejected: untrusted frame' };
    return localWhisperIpc.deleteModel(String(name));
  });
  ipcMain.handle('local-whisper:start', (event, opts: { model: string }) => {
    if (!isTrustedRequest(event)) return { ok: false, error: 'rejected: untrusted frame' };
    return localWhisperIpc.start({ model: String(opts?.model ?? '') });
  });
  ipcMain.handle('local-whisper:transcribe', (event, pcm: ArrayBuffer, opts: { language?: string }) => {
    if (!isTrustedRequest(event)) return { ok: false, error: 'rejected: untrusted frame' };
    return localWhisperIpc.transcribe(pcm, opts || {});
  });
  ipcMain.handle('local-whisper:stop', (event) => {
    if (!isTrustedRequest(event)) return { ok: false };
    return localWhisperIpc.stop();
  });

  // ── Database ──
  ipcMain.handle('db:query', async (_event, sql: string, params?: unknown[]) => {
    return runQuery(sql, params);
  });

  // ── File export ──
  ipcMain.handle('file:export', async (_event, format: string, content: string) => {
    const minutesDir = path.join(app.getPath('home'), 'MeetingAI', 'minutes');
    const fs = await import('node:fs');
    fs.mkdirSync(minutesDir, { recursive: true });

    try {
      const data = JSON.parse(content);

      // SECURITY: the renderer is trusted-ish (it's our own UI) but we
      // never want a filename from IPC to escape minutesDir. A renderer
      // bug or a future "import minutes from elsewhere" feature could
      // accidentally send `../../etc/passwd.docx`. path.basename strips
      // every directory component; sanitizeFilename does a second pass
      // to drop characters the host filesystem might choke on.
      const safeFilename = sanitizeFilenameForExport(
        path.basename(String(data.filename || 'minutes.dat')),
        format,
      );
      const filePath = path.join(minutesDir, safeFilename);

      if (format === 'markdown') {
        fs.writeFileSync(filePath, data.content, 'utf-8');
        console.log('[Export] Markdown saved:', filePath);
        return filePath;
      }

      if (format === 'docx') {
        // Renderer sends `{ filename, minutes, disclaimer }`. We build a
        // real .docx Buffer in the main process (the docx library is a
        // Node module) and write it to ~/MeetingAI/minutes/.
        const buf = await renderMinutesDocx(data.minutes, data.disclaimer);
        fs.writeFileSync(filePath, buf);
        console.log('[Export] DOCX saved:', filePath, `(${buf.length} bytes)`);
        return filePath;
      }

      if (format === 'pdf') {
        // Same `{ filename, minutes, disclaimer }` payload. The PDF is
        // rendered by Electron's own Chromium engine (printToPDF) so
        // CJK renders via system fonts with no bundled font.
        const buf = await renderMinutesPdf(data.minutes, data.disclaimer);
        fs.writeFileSync(filePath, buf);
        console.log('[Export] PDF saved:', filePath, `(${buf.length} bytes)`);
        return filePath;
      }

      return '';
    } catch (err) {
      console.error('[Export] Failed:', err);
      return '';
    }
  });

  // ── AI: Proxy fetch (bypass CORS) ──
  // All AI API calls go through main process to avoid CORS restrictions
  ipcMain.handle('ai:fetch', async (_event, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    console.log(`[AI Fetch] ${init.method || 'GET'} ${url}`);
    try {
      const res = await fetch(url, {
        method: init.method || 'GET',
        headers: init.headers || {},
        body: init.body || undefined,
      });
      console.log(`[AI Fetch] Response: ${res.status} ${res.statusText}`);
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        body: text,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown network error';
      console.error(`[AI Fetch] Error:`, msg);
      return {
        ok: false,
        status: 0,
        statusText: 'Network Error',
        body: '',
        error: msg,
      };
    }
  });

  // ── STT: Deepgram WebSocket proxy (runs in main process to bypass CORS) ──
  let dgWebSocket: import('ws').WebSocket | null = null;

  ipcMain.handle('stt:test-connection', async (_event, engineId: string, apiKey: string) => {
    console.log(`[STT] Testing connection: ${engineId}`);
    if (engineId === 'deepgram') {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch('https://api.deepgram.com/v1/projects', {
          headers: { 'Authorization': `Token ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timer);
        console.log(`[STT] Deepgram test: ${res.status}`);
        if (res.ok) return { ok: true };
        const body = await res.text().catch(() => '');
        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: `API Key is invalid (HTTP ${res.status}) / API Key 无效` };
        }
        return { ok: false, error: `HTTP ${res.status}: ${body.substring(0, 200)}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        const code = (err as NodeJS.ErrnoException).code;
        console.error(`[STT] Deepgram test error:`, msg, code || '');
        if (msg.includes('abort') || code === 'ABORT_ERR') {
          return { ok: false, error: 'Connection timeout. Please check VPN / 连接超时，请检查 VPN' };
        }
        return { ok: false, error: `Network error: ${msg}. Please check VPN / 网络错误，请检查 VPN` };
      }
    }
    return { ok: false, error: `Engine ${engineId} test not implemented` };
  });

  ipcMain.handle('stt:start-session', async (_event, engineId: string, apiKey: string, params: Record<string, string>) => {
    if (engineId !== 'deepgram') return { ok: false, error: 'Only deepgram supported via IPC' };

    const WebSocket = (await import('ws')).default;
    const qs = new URLSearchParams(params).toString();
    const url = `wss://api.deepgram.com/v1/listen?${qs}`;
    const maskedKey = apiKey.length > 8 ? apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4) : '****';
    console.log(`[STT] Deepgram WebSocket connecting to: ${url}`);
    console.log(`[STT] Authorization: Token ${maskedKey}`);

    const TIMEOUT_MS = 30000; // 30s — VPN connections may be slow
    let resolved = false;

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const safeResolve = (result: { ok: boolean; error?: string }) => {
        if (!resolved) { resolved = true; resolve(result); }
      };

      try {
        dgWebSocket = new WebSocket(url, {
          headers: { 'Authorization': `Token ${apiKey}` },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[STT] WebSocket constructor failed:`, msg);
        safeResolve({ ok: false, error: `Cannot create WebSocket: ${msg}` });
        return;
      }

      const timeout = setTimeout(() => {
        console.error(`[STT] Deepgram WebSocket connection timeout after ${TIMEOUT_MS / 1000}s`);
        console.error(`[STT] WebSocket readyState: ${dgWebSocket?.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);
        dgWebSocket?.close();
        dgWebSocket = null;
        safeResolve({
          ok: false,
          error: `Connection timeout (${TIMEOUT_MS / 1000}s). Cannot connect to Deepgram. Please check: 1) VPN is enabled 2) API Key is valid / 无法连接 Deepgram，请检查：1) VPN 是否开启 2) API Key 是否有效`,
        });
      }, TIMEOUT_MS);

      dgWebSocket.on('open', () => {
        clearTimeout(timeout);
        console.log('[STT] Deepgram WebSocket connected successfully');
        safeResolve({ ok: true });
      });

      dgWebSocket.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'Results' && msg.channel?.alternatives?.[0]) {
            const alt = msg.channel.alternatives[0];
            if (!alt.transcript) return;
            const result = {
              text: alt.transcript,
              isFinal: msg.is_final ?? false,
              speaker: alt.words?.[0]?.speaker !== undefined
                ? `Speaker ${alt.words[0].speaker}` : undefined,
              language: msg.channel?.detected_language || undefined,
              startMs: Math.round((msg.start || 0) * 1000),
              endMs: Math.round(((msg.start || 0) + (msg.duration || 0)) * 1000),
              confidence: alt.confidence || 0,
            };
            console.log(`[STT] Transcript: "${result.text.substring(0, 60)}..." final=${result.isFinal}`);
            mainWindow?.webContents.send('stt:transcript', result);
          }
        } catch { /* skip malformed */ }
      });

      dgWebSocket.on('error', (err: Error) => {
        clearTimeout(timeout);
        // Extract underlying network error details
        const cause = (err as NodeJS.ErrnoException).code;
        const detail = cause ? `${err.message} (${cause})` : err.message;
        console.error(`[STT] Deepgram WebSocket error: ${detail}`);

        if (!resolved) {
          let userMsg = `Cannot connect to Deepgram: ${detail}. `;
          if (cause === 'ECONNREFUSED' || cause === 'ETIMEDOUT' || cause === 'ENOTFOUND') {
            userMsg += 'Please check: 1) VPN is enabled 2) Network is connected / 请检查：1) VPN 是否开启 2) 网络是否正常';
          } else if (detail.includes('401') || detail.includes('403')) {
            userMsg += 'API Key may be invalid / API Key 可能无效';
          } else {
            userMsg += 'Please check: 1) VPN is enabled 2) API Key is valid / 请检查：1) VPN 是否开启 2) API Key 是否有效';
          }
          safeResolve({ ok: false, error: userMsg });
        }
        mainWindow?.webContents.send('stt:error', detail);
      });

      dgWebSocket.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeout);
        const reasonStr = reason.toString();
        console.log(`[STT] Deepgram WebSocket closed: code=${code} reason="${reasonStr}"`);
        dgWebSocket = null;

        // If closed before open resolved, treat as connection failure
        if (!resolved) {
          let userMsg = `Deepgram connection closed (code ${code})`;
          if (code === 1008 || reasonStr.includes('auth')) {
            userMsg += '. API Key is invalid / API Key 无效';
          } else {
            userMsg += '. Please check: 1) VPN is enabled 2) API Key is valid / 请检查：1) VPN 是否开启 2) API Key 是否有效';
          }
          safeResolve({ ok: false, error: userMsg });
        }
        mainWindow?.webContents.send('stt:closed');
      });
    });
  });

  let feedAudioLogCount = 0;
  ipcMain.handle('stt:feed-audio', async (_event, int16Buffer: ArrayBuffer) => {
    if (dgWebSocket && dgWebSocket.readyState === 1 /* OPEN */) {
      const buf = Buffer.from(int16Buffer);
      dgWebSocket.send(buf);
      feedAudioLogCount++;
      if (feedAudioLogCount <= 5 || feedAudioLogCount % 50 === 0) {
        console.log(`[STT] Sending audio chunk #${feedAudioLogCount}, size: ${buf.byteLength} bytes`);
      }
    }
  });

  ipcMain.handle('stt:stop-session', async () => {
    console.log('[STT] Stopping session');
    if (dgWebSocket) {
      try {
        if (dgWebSocket.readyState === 1) {
          dgWebSocket.send(JSON.stringify({ type: 'CloseStream' }));
        }
        dgWebSocket.close();
      } catch { /* ignore */ }
      dgWebSocket = null;
    }
    return { ok: true };
  });

  // ── File: Auto-save recording ──
  ipcMain.handle('file:save-recording', async (_event, tempPath: string) => {
    const fs = await import('node:fs');
    if (!tempPath || !fs.existsSync(tempPath)) {
      return { saved: false };
    }

    // Auto-save to recordings directory (no dialog)
    const isDev = !!process.env['VITE_DEV_SERVER_URL'];
    const saveDir = isDev
      ? path.join(path.dirname(__dirname), 'recordings')
      : path.join(app.getPath('home'), 'MeetU', 'recordings');
    fs.mkdirSync(saveDir, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fileName = `MeetU_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.webm`;
    const destPath = path.join(saveDir, fileName);

    try {
      fs.copyFileSync(tempPath, destPath);
      fs.unlinkSync(tempPath);
      console.log(`[File] Recording saved: ${destPath}`);
      return { saved: true, filePath: destPath };
    } catch (err) {
      console.error('[File] Save failed:', err);
      return { saved: true, filePath: tempPath }; // keep temp file as fallback
    }
  });

  ipcMain.handle('file:show-in-folder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // ── Window controls ──
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.on('window:toggle-top', () => {
    const current = mainWindow?.isAlwaysOnTop();
    mainWindow?.setAlwaysOnTop(!current);
  });
  ipcMain.on('window:set-opacity', (_event, opacity: number) => {
    mainWindow?.setOpacity(Math.max(0.5, Math.min(1.0, opacity)));
  });
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  // ── Audio diagnostics ──
  const { systemPreferences } = await import('electron');
  console.log('[Audio] ====== AUDIO DIAGNOSTICS ======');
  console.log('[Audio] Platform:', process.platform);
  console.log('[Audio] Media access status (microphone):', systemPreferences.getMediaAccessStatus('microphone'));
  console.log('[Audio] Media access status (camera):', systemPreferences.getMediaAccessStatus('camera'));
  console.log('[Audio] ================================');

  await initDatabase();
  registerIPC();
  registerDisplayMediaHandler();
  registerShortcuts();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

