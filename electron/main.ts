// ============================================================
// Electron Main Process
// Creates floating window, registers IPC handlers, manages lifecycle
// ============================================================

import { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer } from 'electron';
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
    width: 420,
    height: 700,
    x: screenW - 440,
    y: 80,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
    return getSetting(key);
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    setSetting(key, value);
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
  createWindow();
  registerShortcuts();
  registerIPC();

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
