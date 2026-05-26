// ============================================================
// Preload Script (CommonJS — required by Electron's require() loader)
// Securely expose main process APIs to renderer via contextBridge
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Audio ──
  audio: {
    startRecording: () => ipcRenderer.invoke('audio:start-recording'),
    stopRecording: () => ipcRenderer.invoke('audio:stop-recording'),
    appendChunk: (data) => ipcRenderer.invoke('audio:append-chunk', data),
    isRecording: () => ipcRenderer.invoke('audio:is-recording'),
    getRecordingsPath: () => ipcRenderer.invoke('audio:get-recordings-path'),
    getDevices: () => ipcRenderer.invoke('audio:get-devices'),
    probeSystemAudio: () => ipcRenderer.invoke('system-audio:probe'),
    onChunk: (cb) =>
      ipcRenderer.on('audio:chunk', (_e, chunk) => cb(chunk)),
    onLevel: (cb) =>
      ipcRenderer.on('audio:level', (_e, level) => cb(level)),

    // ── macOS native ScreenCaptureKit capture ──
    macos: {
      listApps: () => ipcRenderer.invoke('macos-system-audio:list-apps'),
      start: (opts) => ipcRenderer.invoke('macos-system-audio:start', opts),
      stop: () => ipcRenderer.invoke('macos-system-audio:stop'),
      // PCM frames (Float32 16-kHz mono ArrayBuffer) pushed from main.
      // Returns an unsubscribe fn so the renderer can detach on stop.
      onPcmFrame: (cb) => {
        const listener = (_e, buf) => cb(buf);
        ipcRenderer.on('macos-system-audio:pcm-frame', listener);
        return () => ipcRenderer.removeListener('macos-system-audio:pcm-frame', listener);
      },
      onError: (cb) => {
        const listener = (_e, err) => cb(err);
        ipcRenderer.on('macos-system-audio:error', listener);
        return () => ipcRenderer.removeListener('macos-system-audio:error', listener);
      },
    },

    // ── Local Whisper (offline whisper.cpp) ──
    localWhisper: {
      probe: () => ipcRenderer.invoke('local-whisper:probe'),
      downloadModel: (name) => ipcRenderer.invoke('local-whisper:download-model', name),
      start: (opts) => ipcRenderer.invoke('local-whisper:start', opts),
      transcribe: (pcm, opts) => ipcRenderer.invoke('local-whisper:transcribe', pcm, opts),
      stop: () => ipcRenderer.invoke('local-whisper:stop'),
      onDownloadProgress: (cb) => {
        const listener = (_e, p) => cb(p);
        ipcRenderer.on('local-whisper:download-progress', listener);
        return () => ipcRenderer.removeListener('local-whisper:download-progress', listener);
      },
    },
  },

  // ── STT ──
  stt: {
    testConnection: (engineId, apiKey) =>
      ipcRenderer.invoke('stt:test-connection', engineId, apiKey),
    startSession: (engineId, apiKey, params) =>
      ipcRenderer.invoke('stt:start-session', engineId, apiKey, params),
    feedAudio: (int16Buffer) =>
      ipcRenderer.invoke('stt:feed-audio', int16Buffer),
    stopSession: () =>
      ipcRenderer.invoke('stt:stop-session'),
    onTranscript: (cb) =>
      ipcRenderer.on('stt:transcript', (_e, result) => cb(result)),
    onError: (cb) =>
      ipcRenderer.on('stt:error', (_e, error) => cb(error)),
    onClosed: (cb) =>
      ipcRenderer.on('stt:closed', () => cb()),
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
    saveRecording: (tempPath) =>
      ipcRenderer.invoke('file:save-recording', tempPath),
    showInFolder: (filePath) =>
      ipcRenderer.invoke('file:show-in-folder', filePath),
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
