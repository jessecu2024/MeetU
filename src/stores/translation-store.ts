// ============================================================
// Translation Store (Zustand)
// Manages real-time translation entries
// ============================================================

import { create } from 'zustand';
import type { TranslationEntry } from '../services/translation';

interface TranslationState {
  entries: TranslationEntry[];
  active: boolean;

  addOrUpdate: (entry: TranslationEntry) => void;
  clear: () => void;
  setActive: (active: boolean) => void;
}

export const useTranslationStore = create<TranslationState>((set) => ({
  entries: [],
  active: false,

  addOrUpdate: (entry) => {
    set((state) => {
      const idx = state.entries.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        const newEntries = [...state.entries];
        newEntries[idx] = entry;
        return { entries: newEntries };
      }
      return { entries: [...state.entries, entry] };
    });
  },

  clear: () => set({ entries: [] }),
  setActive: (active) => set({ active }),
}));
