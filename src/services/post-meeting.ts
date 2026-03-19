// ============================================================
// Post-Meeting Service — Generates final meeting minutes
// Triggered when meeting ends, produces structured JSON minutes
// ============================================================

import { providerRegistry } from './ai-provider';
import { PROMPTS, renderPrompt } from '../config/prompts';
import { useTranscriptStore } from '../stores/transcript-store';
import { useSettingsStore } from '../stores/settings-store';
import type { RealtimeSummary } from './summarizer';

export interface MeetingMinutes {
  title: string;
  executiveSummary: string;
  topics: Array<{
    title: string;
    discussion: string;
    keyPoints: string[];
    decisions: string[];
  }>;
  actionItems: Array<{
    assignee: string;
    task: string;
    deadline: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  openQuestions: string[];
  nextSteps: string;
  nextMeetingSuggestion: string;
}

export async function generateMeetingMinutes(
  meetingId: number,
  durationSec: number,
  summaries: RealtimeSummary[],
): Promise<MeetingMinutes | null> {
  const settings = useSettingsStore.getState();
  const hasKey = !!settings.aiConfig.apiKeys[settings.aiConfig.defaultProvider];

  if (!hasKey) {
    // Return mock minutes
    return {
      title: 'Q1 Review & Q2 Planning / Q1 回顾与 Q2 规划',
      executiveSummary: 'The team reviewed Q1 results showing 15% revenue growth. New onboarding flow achieved 22% conversion lift. Q2 priority is internationalization starting with Japanese and Korean markets. / 团队回顾了 Q1 成果，收入增长 15%。新引导流程转化率提升 22%。Q2 重点是国际化。',
      topics: [
        {
          title: 'Q1 Performance Review / Q1 业绩回顾',
          discussion: 'Revenue up 15% QoQ. New onboarding: +22% conversion. 7-day retention: 42%.',
          keyPoints: ['Revenue +15%', 'Onboarding conversion +22%', 'Retention 35%→42%'],
          decisions: ['Continue current product strategy / 继续当前产品策略'],
        },
        {
          title: 'Q2 Planning / Q2 规划',
          discussion: 'Focus on i18n. Japanese and Korean markets first.',
          keyPoints: ['i18n framework ready / i18n 框架已搭建', 'Japanese beta in May / 5月日语测试版'],
          decisions: ['Prioritize i18n for Q2 / Q2 优先国际化'],
        },
      ],
      actionItems: [
        { assignee: '张明', task: 'Send detailed project plan / 发出详细项目计划', deadline: 'Friday / 周五', priority: 'high' },
        { assignee: 'Michael', task: 'Finalize Japanese distributor partnership / 确定日本分销商合作', deadline: 'End of April / 4月底', priority: 'medium' },
      ],
      openQuestions: ['Japanese distributor timeline / 日本分销商时间线', 'Budget allocation for paid channels / 付费渠道预算分配'],
      nextSteps: 'Finalize i18n by end of April, start Japanese beta in May / 4月底完成国际化，5月启动日语测试',
      nextMeetingSuggestion: 'Q2 kickoff meeting next Monday / 下周一 Q2 启动会',
    };
  }

  try {
    const entries = useTranscriptStore.getState().entries.filter(e => e.isFinal);
    const transcript = entries.map(e => `[${e.speaker || '?'}] ${e.text}`).join('\n');

    const summaryRef = summaries.length > 0
      ? summaries.map(s => `[${s.id}] Key: ${s.keyPoints.join('; ')} | Decisions: ${s.decisions.join('; ')}`).join('\n')
      : '';

    const durationMin = Math.floor(durationSec / 60);
    const speakers = [...new Set(entries.map(e => e.speaker).filter(Boolean))];

    const prompt = renderPrompt(PROMPTS.finalSummary, {
      meeting_topic: 'Meeting',
      meeting_date: new Date().toLocaleDateString(),
      meeting_duration: `${durationMin} min`,
      participants: speakers.join(', ') || 'Unknown',
      full_transcript: transcript.slice(0, 8000), // Limit for token budget
      realtime_summaries: summaryRef,
      preferred_language: settings.userProfile.preferredLanguage === 'zh' ? '中文' : 'English',
    });

    const provider = providerRegistry.getProviderForFunction('post_meeting');
    const response = await provider.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 2000 }
    );

    const minutes = JSON.parse(response.content) as MeetingMinutes;

    // Persist to SQLite
    if (meetingId > 0) {
      window.electronAPI?.db.query(
        'INSERT INTO meeting_minutes (meeting_id, content, format, ai_provider, ai_model) VALUES (?, ?, ?, ?, ?)',
        [meetingId, JSON.stringify(minutes), 'json',
         settings.aiConfig.defaultProvider, 'default']
      ).catch(() => {});
    }

    return minutes;
  } catch (err) {
    console.error('[PostMeeting] Generation failed:', err);
    return null;
  }
}
