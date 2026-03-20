// ============================================================
// Preload Script (CommonJS — required by Electron's require() loader)
// Securely expose main process APIs to renderer via contextBridge
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Audio ──
  audio: {
    getSources: () => ipcRenderer.invoke('audio:get-sources'),
    startRecording: () => ipcRenderer.invoke('audio:start-recording'),
    stopRecording: () => ipcRenderer.invoke('audio:stop-recording'),
    appendChunk: (data) => ipcRenderer.invoke('audio:append-chunk', data),
    isRecording: () => ipcRenderer.invoke('audio:is-recording'),
    getRecordingsPath: () => ipcRenderer.invoke('audio:get-recordings-path'),
    getDevices: () => ipcRenderer.invoke('audio:get-devices'),
    onChunk: (cb) =>
      ipcRenderer.on('audio:chunk', (_e, chunk) => cb(chunk)),
    onLevel: (cb) =>
      ipcRenderer.on('audio:level', (_e, level) => cb(level)),
  },

  // ── STT ──
  stt: {
    onResult: (cb) =>
      ipcRenderer.on('stt:result', (_e, result) => cb(result)),
    onStatus: (cb) =>
      ipcRenderer.on('stt:status', (_e, status) => cb(status)),
  },

  // ── AI ──
  ai: {
    translate: (text, speaker) =>
      ipcRenderer.invoke('ai:translate', text, speaker),
    detectMention: (text, speaker) =>
      ipcRenderer.invoke('ai:detect-mention', text, speaker),
    suggestSpeech: (context) =>
      ipcRenderer.invoke('ai:suggest-speech', context),
    summarize: (segment) =>
      ipcRenderer.invoke('ai:summarize', segment),
    finalSummary: (meetingId) =>
      ipcRenderer.invoke('ai:final-summary', meetingId),
    validateKey: (provider, key) =>
      ipcRenderer.invoke('ai:validate-key', provider, key),
    testConnection: (provider) =>
      ipcRenderer.invoke('ai:test-connection', provider),
    fetch: (url, init) =>
      ipcRenderer.invoke('ai:fetch', url, init),
  },

  // ── Settings ──
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },

  // ── Database ──
  db: {
    query: (sql, params) =>
      ipcRenderer.invoke('db:query', sql, params),
  },

  // ── File ──
  file: {
    export: (format, content) =>
      ipcRenderer.invoke('file:export', format, content),
  },

  // ── Window ──
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleTop: () => ipcRenderer.send('window:toggle-top'),
    setOpacity: (v) => ipcRenderer.send('window:set-opacity', v),
  },

  // ── Shortcuts ──
  onShortcut: {
    toggleRecording: (cb) =>
      ipcRenderer.on('shortcut:toggle-recording', () => cb()),
  },

  // ── Platform info ──
  platform: process.platform,
});
