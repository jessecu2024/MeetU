// ============================================================
// Summarizer Service — Real-time meeting summaries
// Triggers every N minutes, collects transcripts, calls AI
// ============================================================

import { providerRegistry } from './ai-provider';
import { PROMPTS, renderPrompt } from '../config/prompts';
import { useTranscriptStore } from '../stores/transcript-store';
import { useSettingsStore } from '../stores/settings-store';

export interface RealtimeSummary {
  id: string;
  periodStart: number;   // ms offset
  periodEnd: number;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ assignee: string; task: string; deadline: string }>;
  openQuestions: string[];
  isLoading: boolean;
  timestamp: number;
}

type SummaryCallback = (summary: RealtimeSummary) => void;

class SummarizerService {
  private callback: SummaryCallback | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private counter = 0;
  private lastProcessedIdx = 0;
  private active = false;

  onSummary(cb: SummaryCallback): void {
    this.callback = cb;
  }

  start(): void {
    this.active = true;
    this.lastProcessedIdx = 0;
    this.counter = 0;

    const intervalMin = useSettingsStore.getState().appSettings.summaryIntervalMinutes || 5;
    this.interval = setInterval(() => this.generateSummary(), intervalMin * 60 * 1000);
  }

  stop(): void {
    this.active = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Force generate a summary now (e.g., at meeting end) */
  async generateNow(): Promise<RealtimeSummary | null> {
    return this.generateSummary();
  }

  private async generateSummary(): Promise<RealtimeSummary | null> {
    if (!this.active && !this.callback) return null;

    const entries = useTranscriptStore.getState().entries;
    const newEntries = entries.filter(e => e.isFinal).slice(this.lastProcessedIdx);
    if (newEntries.length === 0) return null;

    this.lastProcessedIdx = entries.filter(e => e.isFinal).length;

    const settings = useSettingsStore.getState();
    const hasKey = !!settings.aiConfig.apiKeys[settings.aiConfig.defaultProvider];

    const summaryId = `sum-${++this.counter}`;
    const periodStart = newEntries[0]?.startMs || 0;
    const periodEnd = newEntries[newEntries.length - 1]?.endMs || 0;

    const summary: RealtimeSummary = {
      id: summaryId,
      periodStart,
      periodEnd,
      keyPoints: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
      isLoading: true,
      timestamp: Date.now(),
    };

    this.callback?.(summary);

    if (!hasKey) {
      // Mock summary
      const mock: RealtimeSummary = {
        ...summary,
        keyPoints: [
          'Q1 revenue up 15% QoQ / Q1 收入环比增长 15%',
          'New onboarding flow: 22% conversion lift / 新引导流程转化率提升 22%',
          '7-day retention: 35% → 42% / 7日留存率提升至 42%',
        ],
        decisions: ['Prioritize i18n for Q2 / Q2 优先推进国际化'],
        actionItems: [{ assignee: '张明', task: 'Send project plan by Friday / 周五前发出项目计划', deadline: 'Friday' }],
        openQuestions: ['Japanese distributor timeline / 日本分销商时间线'],
        isLoading: false,
      };
      this.callback?.(mock);
      return mock;
    }

    try {
      const segment = newEntries
        .map(e => `[${e.speaker || '?'}] ${e.text}`)
        .join('\n');

      const formatTime = (ms: number) => {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return `${m}:${String(s).padStart(2, '0')}`;
      };

      const prompt = renderPrompt(PROMPTS.realtimeSummary, {
        meeting_topic: 'Meeting in progress',
        period_start: formatTime(periodStart),
        period_end: formatTime(periodEnd),
        transcript_segment: segment,
      });

      const provider = providerRegistry.getProviderForFunction('summary');
      const response = await provider.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 800 }
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(response.content);
      } catch {
        // AI may return markdown-wrapped JSON or incomplete output — try to extract {...}
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch {
            console.warn('[Summarizer] Could not parse extracted JSON, skipping this summary');
            return summary;
          }
        } else {
          console.warn('[Summarizer] No JSON found in AI response, skipping this summary');
          return summary;
        }
      }
      const result: RealtimeSummary = {
        ...summary,
        keyPoints: parsed.keyPoints as string[] || [],
        decisions: parsed.decisions as string[] || [],
        actionItems: parsed.actionItems as string[] || [],
        openQuestions: parsed.openQuestions as string[] || [],
        isLoading: false,
      };
      this.callback?.(result);

      // Persist to SQLite
      const meetingId = useTranscriptStore.getState().meetingId;
      if (meetingId && meetingId > 0) {
        window.electronAPI?.db.query(
          'INSERT INTO realtime_summaries (meeting_id, period_start, period_end, key_points, decisions, open_items) VALUES (?, ?, ?, ?, ?, ?)',
          [meetingId, periodStart, periodEnd,
           JSON.stringify(result.keyPoints), JSON.stringify(result.decisions),
           JSON.stringify(result.openQuestions)]
        ).catch(() => {});
      }

      return result;
    } catch (err) {
      console.error('[Summarizer] Failed:', err);
      const failed: RealtimeSummary = { ...summary, isLoading: false };
      this.callback?.(failed);
      return failed;
    }
  }
}

export const summarizer = new SummarizerService();
