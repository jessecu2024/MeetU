// ============================================================
// Transcript Store (Zustand)
// Manages real-time transcript entries for the current session
// Persists final results to SQLite via IPC
// ============================================================

import { create } from 'zustand';
import type { TranscriptResult } from '../services/stt-engine/types';

export interface TranscriptEntry {
  id: string;
  text: string;
  isFinal: boolean;
  speaker?: string;
  language?: string;
  startMs: number;
  endMs: number;
  confidence: number;
  timestamp: number; // wall clock time
}

interface TranscriptState {
  entries: TranscriptEntry[];
  meetingId: number | null;
  isMockMode: boolean;
  activeEngineId: string | null;

  // Actions
  startSession: (meetingId: number, engineId: string, isMock: boolean) => void;
  addResult: (result: TranscriptResult) => void;
  endSession: () => void;
  clearEntries: () => void;
  loadHistory: (meetingId: number) => Promise<void>;
}

export const useTranscriptStore = create<TranscriptState>((set, _get) => ({
  entries: [],
  meetingId: null,
  isMockMode: false,
  activeEngineId: null,

  startSession: (meetingId, engineId, isMock) => {
    set({
      entries: [],
      meetingId,
      activeEngineId: engineId,
      isMockMode: isMock,
    });
  },

  addResult: (result: TranscriptResult) => {
    set((state) => {
      const entry: TranscriptEntry = {
        id: result.id,
        text: result.text,
        isFinal: result.isFinal,
        speaker: result.speaker,
        language: result.language,
        startMs: result.startMs,
        endMs: result.endMs,
        confidence: result.confidence,
        timestamp: Date.now(),
      };

      // For interim results, update existing entry with same ID
      if (!result.isFinal) {
        const existingIdx = state.entries.findIndex(e => e.id === result.id);
        if (existingIdx >= 0) {
          const newEntries = [...state.entries];
          newEntries[existingIdx] = entry;
          return { entries: newEntries };
        }
      } else {
        // Final result: replace interim or add new
        const existingIdx = state.entries.findIndex(e => e.id === result.id);
        if (existingIdx >= 0) {
          const newEntries = [...state.entries];
          newEntries[existingIdx] = entry;

          // Persist to SQLite
          if (!state.isMockMode) persistTranscript(state.meetingId, entry);

          return { entries: newEntries };
        }
      }

      // New entry
      if (result.isFinal) {
        if (!state.isMockMode) persistTranscript(state.meetingId, entry);
      }

      return { entries: [...state.entries, entry] };
    });
  },

  endSession: () => {
    set({ meetingId: null, activeEngineId: null });
  },

  clearEntries: () => {
    set({ entries: [] });
  },

  loadHistory: async (meetingId: number) => {
    try {
      const results = await window.electronAPI?.db.query(
        'SELECT * FROM transcripts WHERE meeting_id = ? AND is_final = 1 ORDER BY start_ms ASC',
        [meetingId]
      ) as Array<Record<string, unknown>> | undefined;

      if (results && results.length > 0) {
        const entries: TranscriptEntry[] = results.map((r, i) => ({
          id: `hist-${i}`,
          text: r.text as string,
          isFinal: true,
          speaker: r.speaker as string | undefined,
          language: r.language as string | undefined,
          startMs: (r.start_ms as number) || 0,
          endMs: (r.end_ms as number) || 0,
          confidence: (r.confidence as number) || 0,
          timestamp: 0,
        }));
        set({ entries, meetingId });
      }
    } catch {
      // DB not available
    }
  },
}));

/** Persist a final transcript entry to SQLite via IPC */
function persistTranscript(meetingId: number | null, entry: TranscriptEntry): void {
  if (!meetingId || meetingId < 0) return;
  window.electronAPI?.db.query(
    'INSERT INTO transcripts (meeting_id, speaker, text, language, start_ms, end_ms, confidence, is_final) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [meetingId, entry.speaker || null, entry.text, entry.language || null,
     entry.startMs, entry.endMs, entry.confidence]
  ).catch(() => {});
}
