// ============================================================
// Mention & Speech Advice Store (Zustand)
// Manages @detection results and speech suggestions
// ============================================================

import { create } from 'zustand';
import type { MentionResult } from '../services/mention-detector';
import type { SpeechAdvice } from '../services/speech-advisor';

interface MentionState {
  mentions: MentionResult[];
  advices: SpeechAdvice[];
  activeMention: MentionResult | null;  // Currently showing alert
  showAlert: boolean;
  active: boolean;

  addMention: (mention: MentionResult) => void;
  addOrUpdateAdvice: (advice: SpeechAdvice) => void;
  dismissAlert: () => void;
  clearAll: () => void;
  setActive: (active: boolean) => void;
}

export const useMentionStore = create<MentionState>((set) => ({
  mentions: [],
  advices: [],
  activeMention: null,
  showAlert: false,
  active: false,

  addMention: (mention) => {
    set((state) => ({
      mentions: [...state.mentions, mention],
      activeMention: mention,
      showAlert: true,
    }));
  },

  addOrUpdateAdvice: (advice) => {
    set((state) => {
      const idx = state.advices.findIndex(a => a.id === advice.id);
      if (idx >= 0) {
        const newAdvices = [...state.advices];
        newAdvices[idx] = advice;
        return { advices: newAdvices };
      }
      return { advices: [...state.advices, advice] };
    });
  },

  dismissAlert: () => set({ showAlert: false }),
  clearAll: () => set({ mentions: [], advices: [], activeMention: null, showAlert: false }),
  setActive: (active) => set({ active }),
}));
