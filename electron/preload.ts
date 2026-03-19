// ============================================================
// Preload Script
// 通过 contextBridge 安全地暴露主进程 API 给渲染进程
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 音频 ──
  audio: {
    start: () => ipcRenderer.invoke('audio:start'),
    stop: () => ipcRenderer.invoke('audio:stop'),
    getDevices: () => ipcRenderer.invoke('audio:get-devices'),
    onChunk: (cb: (chunk: ArrayBuffer) => void) =>
      ipcRenderer.on('audio:chunk', (_e, chunk) => cb(chunk)),
    onLevel: (cb: (level: number) => void) =>
      ipcRenderer.on('audio:level', (_e, level) => cb(level)),
  },

  // ── STT ──
  stt: {
    onResult: (cb: (result: unknown) => void) =>
      ipcRenderer.on('stt:result', (_e, result) => cb(result)),
    onStatus: (cb: (status: string) => void) =>
      ipcRenderer.on('stt:status', (_e, status) => cb(status)),
  },

  // ── AI ──
  ai: {
    translate: (text: string, speaker: string) =>
      ipcRenderer.invoke('ai:translate', text, speaker),
    detectMention: (text: string, speaker: string) =>
      ipcRenderer.invoke('ai:detect-mention', text, speaker),
    suggestSpeech: (context: unknown) =>
      ipcRenderer.invoke('ai:suggest-speech', context),
    summarize: (segment: string) =>
      ipcRenderer.invoke('ai:summarize', segment),
    finalSummary: (meetingId: number) =>
      ipcRenderer.invoke('ai:final-summary', meetingId),
    validateKey: (provider: string, key: string) =>
      ipcRenderer.invoke('ai:validate-key', provider, key),
    testConnection: (provider: string) =>
      ipcRenderer.invoke('ai:test-connection', provider),
  },

  // ── 设置 ──
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },

  // ── 数据库 ──
  db: {
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params),
  },

  // ── 文件 ──
  file: {
    export: (format: string, content: string) =>
      ipcRenderer.invoke('file:export', format, content),
  },

  // ── 窗口 ──
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleTop: () => ipcRenderer.send('window:toggle-top'),
    setOpacity: (v: number) => ipcRenderer.send('window:set-opacity', v),
  },

  // ── 快捷键回调 ──
  onShortcut: {
    toggleRecording: (cb: () => void) =>
      ipcRenderer.on('shortcut:toggle-recording', () => cb()),
  },
});
