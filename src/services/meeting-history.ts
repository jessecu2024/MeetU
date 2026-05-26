// ============================================================
// Meeting History service — browse past meetings and full-text-ish
// search across their transcripts.
//
// Transcripts are already persisted to SQLite per-session
// (transcript-store inserts each final line; meeting-store creates /
// ends the meeting row). This service is the read side: list meetings,
// load one meeting's transcript, and search transcript text.
//
// Search uses parameterized `LIKE` (case-insensitive for ASCII;
// substring for CJK). The SQL text is STATIC — the user's query only
// ever flows in as a bound parameter (with LIKE wildcards escaped), so
// even though the renderer composes the SQL string here, the query is
// not an injection vector. FTS5 is a possible future optimization;
// LIKE is more than enough at personal-meeting scale.
//
// The query builders are pure and exported for unit testing; the
// executors wrap them around the `db:query` IPC.
// ============================================================

export interface MeetingRow {
  id: number;
  title: string;
  startTime: string | null;
  endTime: string | null;
  durationSec: number | null;
  sttEngine: string | null;
  status: string | null;
  transcriptCount: number;
}

export interface TranscriptRow {
  speaker: string | null;
  text: string;
  language: string | null;
  startMs: number | null;
  endMs: number | null;
}

export interface SearchHit {
  meetingId: number;
  meetingTitle: string;
  startTime: string | null;
  speaker: string | null;
  text: string;
  startMs: number | null;
}

interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Escape the LIKE metacharacters `%`, `_`, and the escape char `\`
 * itself so a user typing "50%" or "a_b" searches for those literal
 * characters rather than wildcards. Pairs with `ESCAPE '\'` in the SQL.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** List recent meetings with a transcript-line count. */
export function buildListMeetingsQuery(limit = 100): BuiltQuery {
  return {
    sql: `
      SELECT m.id AS id, m.title AS title,
             m.start_time AS startTime, m.end_time AS endTime,
             m.duration_sec AS durationSec, m.stt_engine AS sttEngine,
             m.status AS status,
             (SELECT COUNT(*) FROM transcripts t
                WHERE t.meeting_id = m.id AND t.is_final = 1) AS transcriptCount
      FROM meetings m
      ORDER BY m.start_time DESC
      LIMIT ?`,
    params: [limit],
  };
}

/** Load one meeting's final transcript lines in timeline order. */
export function buildMeetingTranscriptQuery(meetingId: number): BuiltQuery {
  return {
    sql: `
      SELECT speaker, text, language, start_ms AS startMs, end_ms AS endMs
      FROM transcripts
      WHERE meeting_id = ? AND is_final = 1
      ORDER BY start_ms ASC`,
    params: [meetingId],
  };
}

/**
 * Search transcript text across all meetings. Returns matching lines
 * with their meeting context, newest meeting first. The query string is
 * bound as a parameter (LIKE wildcards escaped) — never concatenated.
 */
export function buildSearchQuery(query: string, limit = 200): BuiltQuery {
  return {
    sql: `
      SELECT t.meeting_id AS meetingId, m.title AS meetingTitle,
             m.start_time AS startTime, t.speaker AS speaker,
             t.text AS text, t.start_ms AS startMs
      FROM transcripts t
      JOIN meetings m ON m.id = t.meeting_id
      WHERE t.is_final = 1 AND t.text LIKE ? ESCAPE '\\'
      ORDER BY m.start_time DESC, t.start_ms ASC
      LIMIT ?`,
    params: [`%${escapeLike(query)}%`, limit],
  };
}

/** Delete a meeting and (via ON DELETE CASCADE) all its child rows. */
export function buildDeleteMeetingQuery(meetingId: number): BuiltQuery {
  return { sql: `DELETE FROM meetings WHERE id = ?`, params: [meetingId] };
}

// ── Executors (renderer → db:query IPC) ──

async function runQuery<T>(built: BuiltQuery): Promise<T[]> {
  const rows = await window.electronAPI?.db.query(built.sql, built.params);
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function listMeetings(limit = 100): Promise<MeetingRow[]> {
  return runQuery<MeetingRow>(buildListMeetingsQuery(limit));
}

export async function getMeetingTranscript(meetingId: number): Promise<TranscriptRow[]> {
  return runQuery<TranscriptRow>(buildMeetingTranscriptQuery(meetingId));
}

export async function searchTranscripts(query: string, limit = 200): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return runQuery<SearchHit>(buildSearchQuery(trimmed, limit));
}

export async function deleteMeeting(meetingId: number): Promise<void> {
  const { sql, params } = buildDeleteMeetingQuery(meetingId);
  await window.electronAPI?.db.query(sql, params);
}
