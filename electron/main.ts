// ============================================================
// Electron Main Process
// Creates floating window, registers IPC handlers, manages lifecycle
// ============================================================

import { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, session, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting } from './store';
import {
  startRecording, stopRecording, appendFloat32Chunk,
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

  mainWindow.on('closed', () => {
    mainWindow = null;
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

  // ── Audio: Desktop Capturer Sources ──
  ipcMain.handle('audio:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      return sources.map(s => ({ id: s.id, name: s.name }));
    } catch (err) {
      console.error('[Main] Failed to get desktop sources:', err);
      return [];
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

  ipcMain.handle('audio:append-chunk', async (_event, float32Data: ArrayBuffer) => {
    appendFloat32Chunk(float32Data);
  });

  ipcMain.handle('audio:is-recording', async () => {
    return isFileRecording();
  });

  ipcMain.handle('audio:get-recordings-path', async () => {
    return getRecordingsPath();
  });

  // ── Audio: Legacy (will be used by future phases) ──
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
        const res = await fetch('https://api.deepgram.com/v1/projects', {
          headers: { 'Authorization': `Token ${apiKey}` },
        });
        console.log(`[STT] Deepgram test: ${res.status}`);
        if (res.ok) return { ok: true };
        const body = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${body.substring(0, 200)}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        console.error(`[STT] Deepgram test error:`, msg);
        return { ok: false, error: msg };
      }
    }
    return { ok: false, error: `Engine ${engineId} test not implemented` };
  });

  ipcMain.handle('stt:start-session', async (_event, engineId: string, apiKey: string, params: Record<string, string>) => {
    if (engineId !== 'deepgram') return { ok: false, error: 'Only deepgram supported via IPC' };

    const WebSocket = (await import('ws')).default;
    const qs = new URLSearchParams(params).toString();
    const url = `wss://api.deepgram.com/v1/listen?${qs}`;
    console.log(`[STT] Deepgram WebSocket connecting: ${url}`);

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      dgWebSocket = new WebSocket(url, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });

      const timeout = setTimeout(() => {
        console.error('[STT] Deepgram WebSocket connection timeout');
        dgWebSocket?.close();
        dgWebSocket = null;
        resolve({ ok: false, error: 'Connection timeout (10s)' });
      }, 10000);

      dgWebSocket.on('open', () => {
        clearTimeout(timeout);
        console.log('[STT] Deepgram WebSocket connected');
        resolve({ ok: true });
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
        console.error('[STT] Deepgram WebSocket error:', err.message);
        if (!dgWebSocket || dgWebSocket.readyState !== WebSocket.OPEN) {
          resolve({ ok: false, error: `WebSocket error: ${err.message}` });
        }
        mainWindow?.webContents.send('stt:error', err.message);
      });

      dgWebSocket.on('close', (code: number, reason: Buffer) => {
        console.log(`[STT] Deepgram WebSocket closed: code=${code} reason=${reason.toString()}`);
        dgWebSocket = null;
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

  // ── File: Save recording dialog ──
  let lastSaveDir = '';

  ipcMain.handle('file:save-recording', async (_event, tempPath: string) => {
    const fs = await import('node:fs');
    if (!tempPath || !fs.existsSync(tempPath)) {
      return { saved: false, error: 'No recording file found' };
    }

    // Default directory: project/recordings in dev, or app data in prod
    if (!lastSaveDir) {
      const isDev = !!process.env['VITE_DEV_SERVER_URL'];
      if (isDev) {
        lastSaveDir = path.join(path.dirname(__dirname), 'recordings');
      } else {
        lastSaveDir = path.join(app.getPath('home'), 'MeetU', 'recordings');
      }
      fs.mkdirSync(lastSaveDir, { recursive: true });
    }

    // Generate default filename using current (stop) time
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultName = `MeetU_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.wav`;

    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save Recording / 保存录音',
      defaultPath: path.join(lastSaveDir, defaultName),
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    });

    if (result.canceled || !result.filePath) {
      // User cancelled — delete temp file
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      console.log('[File] Recording discarded by user');
      return { saved: false, discarded: true };
    }

    // Remember the directory for next time
    lastSaveDir = path.dirname(result.filePath);

    // Move temp file to chosen location
    try {
      fs.copyFileSync(tempPath, result.filePath);
      fs.unlinkSync(tempPath);
      console.log(`[File] Recording saved: ${result.filePath}`);
      return { saved: true, filePath: result.filePath };
    } catch (err) {
      console.error('[File] Failed to save recording:', err);
      return { saved: false, error: err instanceof Error ? err.message : 'Save failed' };
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
