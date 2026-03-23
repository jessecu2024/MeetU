// ============================================================
// Electron Main Process
// Creates floating window, registers IPC handlers, manages lifecycle
// ============================================================

import { app, BrowserWindow, ipcMain, screen, globalShortcut, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting } from './store';
import {
  startRecording, stopRecording, appendChunk,
  isRecording as isFileRecording, getRecordingsPath
} from './audio/file-manager';
import { initDatabase, runQuery } from './database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

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
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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

  // ── Audio: desktopCapturer for system audio ──
  ipcMain.handle('audio:get-desktop-source-id', async () => {
    const { desktopCapturer } = await import('electron');
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length > 0) {
        console.log(`[Audio] Desktop sources: ${sources.map(s => s.name).join(', ')}`);
        return sources[0].id; // Return first screen source
      }
      console.warn('[Audio] No desktop sources found');
      return null;
    } catch (err) {
      console.error('[Audio] desktopCapturer.getSources failed:', err);
      return null;
    }
  });

  // ── Audio: Legacy ──
  ipcMain.handle('audio:get-devices', async () => {
    return [];
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

      if (format === 'markdown') {
        const filePath = path.join(minutesDir, data.filename);
        fs.writeFileSync(filePath, data.content, 'utf-8');
        console.log('[Export] Markdown saved:', filePath);
        return filePath;
      }

      if (format === 'docx') {
        // Simple plain-text docx using docx library
        const filePath = path.join(minutesDir, data.filename);
        // For now, save as a text file with .docx extension placeholder
        // Full docx generation requires the docx library in main process
        const mdContent = generateMarkdownFromMinutes(data.minutes, data.disclaimer);
        fs.writeFileSync(filePath.replace('.docx', '.md'), mdContent, 'utf-8');
        console.log('[Export] Saved as MD (docx pending):', filePath.replace('.docx', '.md'));
        return filePath.replace('.docx', '.md');
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

/** Generate markdown from minutes object (for docx fallback) */
function generateMarkdownFromMinutes(
  minutes: Record<string, unknown>,
  disclaimer: { en: string; zh: string }
): string {
  const lines: string[] = [];
  lines.push(`# ${minutes.title || 'Meeting Minutes'}\n`);
  lines.push(`> ${minutes.executiveSummary || ''}\n`);

  const topics = minutes.topics as Array<Record<string, unknown>> | undefined;
  if (topics?.length) {
    lines.push('## Discussion Topics\n');
    for (const t of topics) {
      lines.push(`### ${t.title}\n`);
      lines.push(`${t.discussion}\n`);
      const kp = t.keyPoints as string[] | undefined;
      if (kp?.length) {
        for (const p of kp) lines.push(`- ${p}`);
        lines.push('');
      }
    }
  }

  const actions = minutes.actionItems as Array<Record<string, unknown>> | undefined;
  if (actions?.length) {
    lines.push('## Action Items\n');
    for (const a of actions) {
      lines.push(`- **${a.assignee}**: ${a.task} (${a.deadline || 'TBD'}) [${a.priority}]`);
    }
    lines.push('');
  }

  lines.push('---\n');
  lines.push(`*${disclaimer.en}*\n`);
  lines.push(`*${disclaimer.zh}*`);

  return lines.join('\n');
}
