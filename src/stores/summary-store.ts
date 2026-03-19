// ============================================================
// Summary Store (Zustand)
// Manages real-time summaries and post-meeting minutes
// ============================================================

import { create } from 'zustand';
import type { RealtimeSummary } from '../services/summarizer';
import type { MeetingMinutes } from '../services/post-meeting';

interface SummaryState {
  summaries: RealtimeSummary[];
  meetingMinutes: MeetingMinutes | null;
  isGeneratingMinutes: boolean;
  minutesError: string | null;
  active: boolean;

  addOrUpdateSummary: (summary: RealtimeSummary) => void;
  setMeetingMinutes: (minutes: MeetingMinutes | null) => void;
  setGeneratingMinutes: (generating: boolean) => void;
  setMinutesError: (error: string | null) => void;
  clear: () => void;
  setActive: (active: boolean) => void;
}

export const useSummaryStore = create<SummaryState>((set) => ({
  summaries: [],
  meetingMinutes: null,
  isGeneratingMinutes: false,
  minutesError: null,
  active: false,

  addOrUpdateSummary: (summary) => {
    set((state) => {
      const idx = state.summaries.findIndex(s => s.id === summary.id);
      if (idx >= 0) {
        const newSummaries = [...state.summaries];
        newSummaries[idx] = summary;
        return { summaries: newSummaries };
      }
      return { summaries: [...state.summaries, summary] };
    });
  },

  setMeetingMinutes: (minutes) => set({ meetingMinutes: minutes }),
  setGeneratingMinutes: (generating) => set({ isGeneratingMinutes: generating }),
  setMinutesError: (error) => set({ minutesError: error }),
  clear: () => set({ summaries: [], meetingMinutes: null, minutesError: null }),
  setActive: (active) => set({ active }),
}));
