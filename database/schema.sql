-- ============================================================
-- MeetU — SQLite Database Schema
-- ============================================================

-- 会议主表
CREATE TABLE IF NOT EXISTS meetings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL DEFAULT '未命名会议',
  platform      TEXT,                  -- 'zoom' | 'teams' | 'tencent' | 'other'
  start_time    DATETIME NOT NULL DEFAULT (datetime('now')),
  end_time      DATETIME,
  duration_sec  INTEGER,               -- 自动计算
  audio_path    TEXT,                   -- 录音文件路径
  status        TEXT DEFAULT 'active',  -- 'active' | 'ended' | 'archived'
  participants  TEXT,                   -- JSON: ["张三", "Sarah", ...]
  ai_provider   TEXT,                   -- 使用的 AI 提供商
  stt_engine    TEXT,                   -- 使用的 STT 引擎
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- 转写记录表
CREATE TABLE IF NOT EXISTS transcripts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker       TEXT,                   -- 说话人标识
  text          TEXT NOT NULL,          -- 原文
  language      TEXT,                   -- 'en' | 'zh' | 'ja' | ...
  start_ms      INTEGER,               -- 开始时间（会议起始的毫秒偏移）
  end_ms        INTEGER,               -- 结束时间
  confidence    REAL,                   -- STT 置信度 0-1
  is_final      INTEGER DEFAULT 1,     -- 是否为最终结果
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- 翻译记录表
CREATE TABLE IF NOT EXISTS translations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  source_lang   TEXT NOT NULL,
  target_lang   TEXT NOT NULL,
  translated    TEXT NOT NULL,
  ai_provider   TEXT,                   -- 翻译使用的 AI
  ai_model      TEXT,
  latency_ms    INTEGER,
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- @检测与发言建议表
CREATE TABLE IF NOT EXISTS mentions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  transcript_id INTEGER REFERENCES transcripts(id),
  trigger_type  TEXT NOT NULL,          -- 'direct_name' | 'implicit' | 'question'
  trigger_text  TEXT NOT NULL,          -- 触发@的原始文本
  question      TEXT,                   -- AI 提取的具体问题
  suggestions   TEXT,                   -- JSON: [{label, text, confidence}]
  selected      INTEGER,               -- 用户选择了哪个建议（index）
  dismissed     INTEGER DEFAULT 0,     -- 是否被忽略
  detected_at   DATETIME DEFAULT (datetime('now'))
);

-- 实时摘要表（每5分钟一条）
CREATE TABLE IF NOT EXISTS realtime_summaries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  period_start  INTEGER,               -- 摘要覆盖的开始时间（ms）
  period_end    INTEGER,               -- 摘要覆盖的结束时间（ms）
  key_points    TEXT,                   -- JSON: ["要点1", "要点2"]
  decisions     TEXT,                   -- JSON: ["决策1"]
  open_items    TEXT,                   -- JSON: ["未解决1"]
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- 会后纪要表
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,          -- JSON: 完整结构化纪要
  format        TEXT DEFAULT 'json',    -- 'json' | 'markdown' | 'html'
  export_path   TEXT,                   -- 导出的文件路径
  ai_provider   TEXT,
  ai_model      TEXT,
  token_usage   TEXT,                   -- JSON: {input, output}
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- AI 用量统计表（用于成本追踪）
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id    INTEGER REFERENCES meetings(id),
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  function_type TEXT NOT NULL,          -- 'translation' | 'mention' | 'summary' | ...
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms    INTEGER,
  cost_usd      REAL,                  -- 估算费用
  created_at    DATETIME DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_translations_transcript ON translations(transcript_id);
CREATE INDEX IF NOT EXISTS idx_mentions_meeting ON mentions(meeting_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting ON realtime_summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_usage_meeting ON ai_usage_log(meeting_id, created_at);
