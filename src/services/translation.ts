// ============================================================
// Translation Service
// Monitors transcript entries, auto-translates via AI provider
// EN→中 / 中→EN, uses custom glossary from settings
// ============================================================

import { providerRegistry } from './ai-provider';
import { PROMPTS, renderPrompt } from '../config/prompts';
import { useSettingsStore } from '../stores/settings-store';
import type { TranscriptEntry } from '../stores/transcript-store';

export interface TranslationEntry {
  id: string;
  transcriptId: string;
  speaker?: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  isStreaming: boolean;
  timestamp: number;
}

type TranslationCallback = (entry: TranslationEntry) => void;

class TranslationService {
  private callback: TranslationCallback | null = null;
  private processedIds = new Set<string>();
  private counter = 0;
  private active = false;

  onTranslation(cb: TranslationCallback): void {
    this.callback = cb;
  }

  start(): void {
    this.active = true;
    this.processedIds.clear();
  }

  stop(): void {
    this.active = false;
    this.processedIds.clear();
  }

  /** Process a new final transcript entry */
  async processEntry(entry: TranscriptEntry): Promise<void> {
    if (!this.active || !entry.isFinal) return;
    if (this.processedIds.has(entry.id)) return;
    this.processedIds.add(entry.id);

    const settings = useSettingsStore.getState();
    const hasKey = !!settings.aiConfig.apiKeys[settings.aiConfig.defaultProvider];
    if (!hasKey) return;

    // Detect language and determine translation direction
    const sourceLang = this.detectLanguage(entry.text);
    const targetLang = sourceLang === 'zh' ? 'en' : 'zh';

    const translationId = `tr-${++this.counter}`;

    // Emit initial streaming entry
    const result: TranslationEntry = {
      id: translationId,
      transcriptId: entry.id,
      speaker: entry.speaker,
      originalText: entry.text,
      translatedText: '',
      sourceLang,
      targetLang,
      isStreaming: true,
      timestamp: Date.now(),
    };
    this.callback?.(result);

    try {
      // Build glossary string
      const glossary = settings.customTerms.length > 0
        ? settings.customTerms.map(t => `${t.source} → ${t.target}`).join('\n')
        : '';

      const prompt = renderPrompt(PROMPTS.translation, {
        meeting_topic: 'Meeting in progress',
        custom_terms: glossary,
        speaker: entry.speaker || 'Unknown',
        text: entry.text,
      });

      // Use streaming for faster perceived response
      const provider = providerRegistry.getProviderForFunction('translation');
      let accumulated = '';

      for await (const event of provider.streamChat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 500 }
      )) {
        if (event.type === 'text_delta' && event.text) {
          accumulated += event.text;
          this.callback?.({
            ...result,
            translatedText: accumulated,
            isStreaming: true,
          });
        }
        if (event.type === 'done') {
          this.callback?.({
            ...result,
            translatedText: accumulated || result.translatedText,
            isStreaming: false,
          });
        }
      }

      // Ensure final state
      if (accumulated) {
        this.callback?.({
          ...result,
          translatedText: accumulated,
          isStreaming: false,
        });
      }
    } catch (err) {
      console.error('[Translation] Failed:', err);
      this.callback?.({
        ...result,
        translatedText: `[Translation error / 翻译失败]`,
        isStreaming: false,
      });
    }
  }

  /** Detect source language (delegates to pure helper for testability) */
  private detectLanguage(text: string): string {
    return detectLanguage(text);
  }
}

/**
 * Heuristic language detection: returns 'zh' if Han characters exceed 30% of
 * non-whitespace characters, otherwise 'en'. Pure function \u2014 exported so it
 * can be unit-tested without instantiating the translation service.
 */
export function detectLanguage(text: string): 'zh' | 'en' {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && chineseChars / totalChars > 0.3 ? 'zh' : 'en';
}

export const translationService = new TranslationService();
