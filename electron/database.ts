// ============================================================
// SQLite Database Manager (Main Process)
// Uses better-sqlite3 for synchronous, fast local storage
// Falls back gracefully if native module is unavailable
// ============================================================

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let db: { prepare: (sql: string) => { run: (...args: unknown[]) => { lastInsertRowid: number | bigint }; all: (...args: unknown[]) => unknown[]; }; exec: (sql: string) => void; pragma: (stmt: string) => void } | null = null;
let available = false;

/** Initialize the database */
export async function initDatabase(): Promise<boolean> {
  try {
    // Use createRequire for native modules in ESM context
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');

    const dbDir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'meetings.db');

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create tables
    createTables();

    available = true;
    console.log('[DB] SQLite initialized:', dbPath);
    return true;
  } catch (err) {
    console.warn('[DB] SQLite not available, using in-memory fallback:', err);
    available = false;
    return false;
  }
}

function createTables(): void {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL DEFAULT 'Untitled Meeting',
      start_time    DATETIME NOT NULL DEFAULT (datetime('now')),
      end_time      DATETIME,
      duration_sec  INTEGER,
      audio_path    TEXT,
      status        TEXT DEFAULT 'active',
      ai_provider   TEXT,
      stt_engine    TEXT,
      created_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      speaker       TEXT,
      text          TEXT NOT NULL,
      language      TEXT,
      start_ms      INTEGER,
      end_ms        INTEGER,
      confidence    REAL,
      is_final      INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id, start_ms);
  `);
}

/** Check if database is available */
export function isDBAvailable(): boolean {
  return available;
}

// ── Meeting Operations ──

export function createMeeting(audioPath?: string, aiProvider?: string, sttEngine?: string): number {
  if (!db) return -1;
  const stmt = db.prepare(
    'INSERT INTO meetings (audio_path, ai_provider, stt_engine) VALUES (?, ?, ?)'
  );
  const result = stmt.run(audioPath || null, aiProvider || null, sttEngine || null);
  return result.lastInsertRowid as number;
}

export function endMeeting(meetingId: number, durationSec: number): void {
  if (!db) return;
  db.prepare(
    "UPDATE meetings SET end_time = datetime('now'), duration_sec = ?, status = 'ended' WHERE id = ?"
  ).run(durationSec, meetingId);
}

export function getMeetings(limit = 50): unknown[] {
  if (!db) return [];
  return db.prepare(
    'SELECT * FROM meetings ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// ── Transcript Operations ──

export function insertTranscript(
  meetingId: number,
  text: string,
  speaker?: string,
  language?: string,
  startMs?: number,
  endMs?: number,
  confidence?: number,
  isFinal = true,
): number {
  if (!db) return -1;
  const stmt = db.prepare(
    'INSERT INTO transcripts (meeting_id, speaker, text, language, start_ms, end_ms, confidence, is_final) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    meetingId, speaker || null, text, language || null,
    startMs ?? null, endMs ?? null, confidence ?? null, isFinal ? 1 : 0
  );
  return result.lastInsertRowid as number;
}

export function getTranscripts(meetingId: number): unknown[] {
  if (!db) return [];
  return db.prepare(
    'SELECT * FROM transcripts WHERE meeting_id = ? AND is_final = 1 ORDER BY start_ms ASC'
  ).all(meetingId);
}

// ── Generic Query ──

export function runQuery(sql: string, params?: unknown[]): unknown {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return params ? stmt.all(...params) : stmt.all();
    }
    return params ? stmt.run(...params) : stmt.run();
  } catch (err) {
    console.error('[DB] Query error:', err);
    return [];
  }
}
