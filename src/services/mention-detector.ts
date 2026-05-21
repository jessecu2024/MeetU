// ============================================================
// Mention Detector — Detects when user is mentioned/@'d in meeting
// Two-layer strategy:
//   Layer 1: Fast keyword matching (zero latency)
//   Layer 2: AI semantic detection (accurate, triggered selectively)
// ============================================================

import { providerRegistry } from './ai-provider';
import { PROMPTS, renderPrompt } from '../config/prompts';
import { useSettingsStore } from '../stores/settings-store';
import { parseAIJson } from './parse-ai-json';
import type { TranscriptEntry } from '../stores/transcript-store';

export interface MentionResult {
  id: string;
  transcriptId: string;
  speaker?: string;
  triggerText: string;
  mentionType: 'direct_name' | 'implicit' | 'question' | 'none';
  extractedQuestion: string;
  confidence: number;
  urgency: 'high' | 'medium' | 'low';
  timestamp: number;
}

type MentionCallback = (result: MentionResult) => void;

class MentionDetectorService {
  private callback: MentionCallback | null = null;
  private processedIds = new Set<string>();
  private counter = 0;
  private active = false;

  onMention(cb: MentionCallback): void {
    this.callback = cb;
  }

  start(): void {
    this.active = true;
    this.processedIds.clear();
  }

  stop(): void {
    this.active = false;
  }

  /** Process a new final transcript entry */
  async processEntry(entry: TranscriptEntry): Promise<void> {
    if (!this.active || !entry.isFinal) return;
    if (this.processedIds.has(entry.id)) return;
    this.processedIds.add(entry.id);

    const settings = useSettingsStore.getState();
    const { name, nameEn, aliases } = settings.userProfile;

    // Skip if no user profile configured
    if (!name && !nameEn) return;

    // Layer 1: Fast keyword matching
    const keywordHit = this.keywordMatch(entry.text, name, nameEn, aliases);
    const hasQuestion = /\?|？/.test(entry.text);

    // Only proceed to AI if keyword hit or question mark detected
    if (!keywordHit && !hasQuestion) return;

    const hasKey = !!settings.aiConfig.apiKeys[settings.aiConfig.defaultProvider];

    if (hasKey) {
      // Layer 2: AI semantic detection
      await this.aiDetect(entry, settings);
    } else {
      // No AI available — use keyword result directly
      if (keywordHit) {
        this.callback?.({
          id: `mention-${++this.counter}`,
          transcriptId: entry.id,
          speaker: entry.speaker,
          triggerText: entry.text,
          mentionType: 'direct_name',
          extractedQuestion: hasQuestion ? entry.text : '',
          confidence: 0.7,
          urgency: hasQuestion ? 'high' : 'medium',
          timestamp: Date.now(),
        });
      }
    }
  }

  /** Layer 1: Fast keyword matching (delegates to pure helper for testability) */
  private keywordMatch(text: string, name: string, nameEn: string, aliases: string[]): boolean {
    return keywordMatch(text, name, nameEn, aliases);
  }

  /** Layer 2: AI semantic detection */
  private async aiDetect(
    entry: TranscriptEntry,
    settings: ReturnType<typeof useSettingsStore.getState>,
  ): Promise<void> {
    try {
      const prompt = renderPrompt(PROMPTS.mentionDetect, {
        user_name: settings.userProfile.name,
        user_name_en: settings.userProfile.nameEn,
        user_aliases: settings.userProfile.aliases.join(', '),
        user_role: settings.userProfile.role,
        speaker: entry.speaker || 'Unknown',
        text: entry.text,
      });

      const provider = providerRegistry.getProviderForFunction('mention_detect');
      const response = await provider.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 200 }
      );

      const parsed = parseAIJson<Record<string, unknown>>(response.content);
      if (parsed.isMentioned) {
        const result: MentionResult = {
          id: `mention-${++this.counter}`,
          transcriptId: entry.id,
          speaker: entry.speaker,
          triggerText: entry.text,
          mentionType: parsed.mentionType || 'direct_name',
          extractedQuestion: parsed.extractedQuestion || '',
          confidence: parsed.confidence || 0.8,
          urgency: parsed.urgency || 'medium',
          timestamp: Date.now(),
        };
        this.callback?.(result);

        // Persist to SQLite
        this.persistMention(result);
      }
    } catch (err) {
      console.error('[MentionDetector] AI detection failed:', err);
    }
  }

  private persistMention(result: MentionResult): void {
    const meetingId = -1; // Will be set by the store
    window.electronAPI?.db.query(
      'INSERT INTO mentions (meeting_id, trigger_type, trigger_text, question) VALUES (?, ?, ?, ?)',
      [meetingId, result.mentionType, result.triggerText, result.extractedQuestion]
    ).catch(() => {});
  }
}

export const mentionDetector = new MentionDetectorService();

/**
 * Case-insensitive keyword matching against any of the user's identifiers
 * (Chinese name, English name, aliases). Empty / whitespace-only candidates
 * are ignored so an unconfigured profile cannot accidentally match every line.
 * Pure function — exported for unit testing.
 */
export function keywordMatch(
  text: string,
  name: string,
  nameEn: string,
  aliases: string[],
): boolean {
  const lower = text.toLowerCase();
  const candidates = [name, nameEn, ...aliases]
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  return candidates.some(n => lower.includes(n.toLowerCase()));
}
