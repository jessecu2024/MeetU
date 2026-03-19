// ============================================================
// Speech Advisor — Generates reply suggestions when user is @'d
// Produces 3 strategies: conservative / assertive / diplomatic
// ============================================================

import { providerRegistry } from './ai-provider';
import { PROMPTS, renderPrompt } from '../config/prompts';
import { useSettingsStore } from '../stores/settings-store';
import { useTranscriptStore } from '../stores/transcript-store';
import type { MentionResult } from './mention-detector';

export interface SpeechSuggestion {
  label: string;
  text: string;
  tone: 'conservative' | 'assertive' | 'diplomatic';
  confidence: number;
}

export interface SpeechAdvice {
  id: string;
  mentionId: string;
  triggerSpeaker?: string;
  triggerText: string;
  extractedQuestion: string;
  suggestions: SpeechSuggestion[];
  isLoading: boolean;
  error?: string;
  timestamp: number;
}

type AdviceCallback = (advice: SpeechAdvice) => void;

class SpeechAdvisorService {
  private callback: AdviceCallback | null = null;
  private counter = 0;

  onAdvice(cb: AdviceCallback): void {
    this.callback = cb;
  }

  /** Generate speech suggestions for a mention */
  async generateAdvice(mention: MentionResult): Promise<void> {
    const settings = useSettingsStore.getState();
    const hasKey = !!settings.aiConfig.apiKeys[settings.aiConfig.defaultProvider];

    const adviceId = `advice-${++this.counter}`;
    const advice: SpeechAdvice = {
      id: adviceId,
      mentionId: mention.id,
      triggerSpeaker: mention.speaker,
      triggerText: mention.triggerText,
      extractedQuestion: mention.extractedQuestion,
      suggestions: [],
      isLoading: true,
      timestamp: Date.now(),
    };

    this.callback?.(advice);

    if (!hasKey) {
      this.callback?.({
        ...advice,
        isLoading: false,
        error: 'AI not configured / AI 未配置',
      });
      return;
    }

    try {
      // Gather recent context (last 5 minutes of transcripts)
      const entries = useTranscriptStore.getState().entries;
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const recentEntries = entries
        .filter(e => e.isFinal && e.timestamp > fiveMinAgo)
        .slice(-20); // Last 20 entries max

      const recentContext = recentEntries
        .map(e => `[${e.speaker || '?'}] ${e.text}`)
        .join('\n');

      const prompt = renderPrompt(PROMPTS.speechSuggest, {
        meeting_topic: 'Meeting in progress',
        user_role: settings.userProfile.role || 'Participant',
        preferred_language: settings.userProfile.preferredLanguage === 'zh' ? '中文' : 'English',
        recent_context: recentContext || '(No recent context)',
        trigger_speaker: mention.speaker || 'Someone',
        trigger_text: mention.triggerText,
        extracted_question: mention.extractedQuestion || mention.triggerText,
      });

      const provider = providerRegistry.getProviderForFunction('speech_suggest');
      const response = await provider.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.7, maxTokens: 1000 }
      );

      const suggestions = JSON.parse(response.content) as SpeechSuggestion[];
      this.callback?.({
        ...advice,
        suggestions,
        isLoading: false,
      });
    } catch (err) {
      console.error('[SpeechAdvisor] Failed:', err);
      this.callback?.({
        ...advice,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Generation failed / 生成失败',
      });
    }
  }
}

export const speechAdvisor = new SpeechAdvisorService();
