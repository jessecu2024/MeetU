// ============================================================
// Meeting History Modal — browse past meetings and search their
// transcripts. Opened from the Header (🕘). Read-only over the local
// SQLite store via src/services/meeting-history.ts.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import {
  listMeetings, getMeetingTranscript, searchTranscripts, deleteMeeting,
  type MeetingRow, type TranscriptRow, type SearchHit,
} from '../services/meeting-history';

function formatDate(s: string | null): string {
  if (!s) return '—';
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC.
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatTime(ms: number | null): string {
  if (ms == null) return '';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Split `text` around the first case-insensitive match of `query` for highlighting. */
function highlightParts(text: string, query: string): { before: string; match: string; after: string } | null {
  if (!query) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return null;
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length),
  };
}

export default function HistoryModal() {
  const close = useSettingsStore((s) => s.closeHistoryModal);

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  // Detail view: a selected meeting + its transcript.
  const [selected, setSelected] = useState<{ id: number; title: string; startTime: string | null } | null>(null);
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const refreshMeetings = useCallback(() => {
    setLoading(true);
    listMeetings()
      .then(setMeetings)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refreshMeetings(); }, [refreshMeetings]);

  // Debounced search as the user types.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits([]); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(() => {
      searchTranscripts(q)
        .then(setHits)
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const openMeeting = async (id: number, title: string, startTime: string | null) => {
    setSelected({ id, title, startTime });
    setTranscript([]);
    setTranscript(await getMeetingTranscript(id));
  };

  const confirmDelete = async (id: number) => {
    await deleteMeeting(id);
    setPendingDelete(null);
    if (selected?.id === id) setSelected(null);
    refreshMeetings();
  };

  const searchActive = query.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md mx-4
        max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Meeting History</h2>
            <p className="text-xs text-zinc-500">会议历史</p>
          </div>
          <button
            onClick={close}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="Close / 关闭">✕</button>
        </div>

        {/* Detail view */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-5 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setSelected(null)}
                className="text-xs text-blue-600 hover:underline mb-1">← Back / 返回</button>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white truncate">{selected.title}</h3>
              <p className="text-xs text-zinc-500">{formatDate(selected.startTime)}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {transcript.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-8">No transcript lines / 无转写记录</p>
              ) : transcript.map((t, i) => (
                <div key={i} className="text-xs">
                  <span className="text-zinc-400 font-mono mr-2">{formatTime(t.startMs)}</span>
                  {t.speaker && <span className="text-blue-600 dark:text-blue-400 mr-1">{t.speaker}:</span>}
                  <span className="text-zinc-700 dark:text-zinc-300">{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Search box */}
            <div className="px-5 pb-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts… / 搜索转写内容…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600
                  bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {searchActive ? (
                /* ── Search results ── */
                searching && hits.length === 0 ? (
                  <p className="text-xs text-zinc-400 text-center py-8">Searching… / 搜索中…</p>
                ) : hits.length === 0 ? (
                  <p className="text-xs text-zinc-400 text-center py-8">No matches / 无匹配结果</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-zinc-400">{hits.length} matching line(s) / 条匹配</p>
                    {hits.map((h, i) => {
                      const parts = highlightParts(h.text, query.trim());
                      return (
                        <button key={i}
                          onClick={() => openMeeting(h.meetingId, h.meetingTitle, h.startTime)}
                          className="w-full text-left p-2 rounded-lg border border-zinc-200 dark:border-zinc-700
                            hover:border-blue-400 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{h.meetingTitle}</span>
                            <span className="text-[10px] text-zinc-400 shrink-0">{formatDate(h.startTime)}</span>
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            <span className="text-zinc-400 font-mono mr-1">{formatTime(h.startMs)}</span>
                            {parts ? (
                              <>{parts.before}<mark className="bg-yellow-200 dark:bg-yellow-700/60 rounded px-0.5">{parts.match}</mark>{parts.after}</>
                            ) : h.text}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                /* ── Meeting list ── */
                loading ? (
                  <p className="text-xs text-zinc-400 text-center py-8">Loading… / 加载中…</p>
                ) : meetings.length === 0 ? (
                  <p className="text-xs text-zinc-400 text-center py-8">
                    No past meetings yet. Record one to see it here. / 暂无历史会议，录制后会显示在这里。
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {meetings.map((m) => (
                      <div key={m.id}
                        className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-blue-400 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => openMeeting(m.id, m.title, m.startTime)}
                            className="flex-1 text-left min-w-0">
                            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 block truncate">{m.title}</span>
                            <span className="text-[11px] text-zinc-400">
                              {formatDate(m.startTime)}
                              {formatDuration(m.durationSec) && ` · ${formatDuration(m.durationSec)}`}
                              {` · ${m.transcriptCount} lines`}
                              {m.sttEngine && ` · ${m.sttEngine}`}
                            </span>
                          </button>
                          {pendingDelete === m.id ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <button onClick={() => confirmDelete(m.id)}
                                className="text-[11px] px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                              <button onClick={() => setPendingDelete(null)}
                                className="text-[11px] px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-500">Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => setPendingDelete(m.id)}
                              title="Delete meeting / 删除会议"
                              className="shrink-0 text-zinc-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">🗑</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
