// ============================================================
// IPC 频道常量
// 渲染进程与主进程的所有通信频道在此定义
// ============================================================

export const IPC = {
  // ── 音频 ──
  AUDIO_START:        'audio:start',
  AUDIO_STOP:         'audio:stop',
  AUDIO_CHUNK:        'audio:chunk',         // 主→渲染：音频数据块
  AUDIO_GET_DEVICES:  'audio:get-devices',
  AUDIO_LEVEL:        'audio:level',         // 主→渲染：音量电平

  // ── STT ──
  STT_RESULT:         'stt:result',          // 主→渲染：转写结果
  STT_STATUS:         'stt:status',          // 连接状态

  // ── AI ──
  AI_TRANSLATE:       'ai:translate',
  AI_DETECT_MENTION:  'ai:detect-mention',
  AI_SUGGEST_SPEECH:  'ai:suggest-speech',
  AI_SUMMARIZE:       'ai:summarize',
  AI_FINAL_SUMMARY:   'ai:final-summary',
  AI_VALIDATE_KEY:    'ai:validate-key',
  AI_TEST_CONNECTION: 'ai:test-connection',

  // ── 设置 ──
  SETTINGS_GET:       'settings:get',
  SETTINGS_SET:       'settings:set',

  // ── 数据库 ──
  DB_QUERY:           'db:query',

  // ── 文件 ──
  FILE_EXPORT:        'file:export',

  // ── 窗口 ──
  WINDOW_MINIMIZE:    'window:minimize',
  WINDOW_CLOSE:       'window:close',
  WINDOW_TOGGLE_TOP:  'window:toggle-top',
  WINDOW_SET_OPACITY: 'window:set-opacity',

  // ── 快捷键回调 ──
  SHORTCUT_TOGGLE_RECORDING: 'shortcut:toggle-recording',
} as const;
