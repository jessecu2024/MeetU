// ============================================================
// Electron 主进程入口
// 创建悬浮窗、注册 IPC 处理器、管理生命周期
// ============================================================

import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

/** 创建主窗口（悬浮模式） */
function createWindow(): void {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 420,
    height: 620,
    x: screenW - 440,      // 屏幕右侧
    y: 80,
    frame: false,           // 无边框
    transparent: false,
    alwaysOnTop: true,      // 悬浮置顶
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,       // 需要访问原生模块
    },
  });

  // vite-plugin-electron 在开发模式注入 VITE_DEV_SERVER_URL
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

/** 注册全局快捷键 */
function registerShortcuts(): void {
  // Ctrl/Cmd + Shift + M: 开始/暂停录制
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    mainWindow?.webContents.send('shortcut:toggle-recording');
  });

  // Ctrl/Cmd + Shift + H: 显示/隐藏窗口
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

/** 注册 IPC 处理器 */
function registerIPC(): void {
  // ── 设置相关 ──
  ipcMain.handle('settings:get', async (_event, key: string) => {
    // TODO: 从 electron-store 读取设置
    return null;
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    // TODO: 写入 electron-store
  });

  // ── 音频相关 ──
  ipcMain.handle('audio:start', async () => {
    // TODO: 启动音频捕获
    console.log('[Main] Audio capture starting...');
  });

  ipcMain.handle('audio:stop', async () => {
    // TODO: 停止音频捕获
    console.log('[Main] Audio capture stopping...');
  });

  ipcMain.handle('audio:get-devices', async () => {
    // TODO: 获取音频设备列表
    return [];
  });

  // ── 数据库相关 ──
  ipcMain.handle('db:query', async (_event, sql: string, params?: unknown[]) => {
    // TODO: 执行 SQLite 查询
    return [];
  });

  // ── 文件相关 ──
  ipcMain.handle('file:export', async (_event, format: string, content: string) => {
    // TODO: 导出文件（Word/PDF/Markdown）
  });

  // ── 窗口控制 ──
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

// ── App 生命周期 ──
app.whenReady().then(() => {
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
