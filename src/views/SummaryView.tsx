// ============================================================
// SummaryView — Real-time summaries + post-meeting minutes
// Bilingual UI: English / Chinese
// ============================================================

import { useSummaryStore } from '../stores/summary-store';
import { useSettingsStore } from '../stores/settings-store';
import { useMeetingStore } from '../stores/meeting-store';
import { exportMarkdown, exportWord } from '../services/exporter';
import type { RealtimeSummary } from '../services/summarizer';
import type { MeetingMinutes } from '../services/post-meeting';

export default function SummaryView() {
  const summaries = useSummaryStore((s) => s.summaries);
  const minutes = useSummaryStore((s) => s.meetingMinutes);
  const isGenerating = useSummaryStore((s) => s.isGeneratingMinutes);
  const minutesError = useSummaryStore((s) => s.minutesError);
  const isRecording = useMeetingStore((s) => s.isRecording);
  const hasAiKey = useSettingsStore((s) => !!s.aiConfig.apiKeys[s.aiConfig.defaultProvider]);
  const openSettings = useSettingsStore((s) => s.openSettingsModal);

  if (!hasAiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">AI not configured — summaries require an API Key</p>
          <p className="text-zinc-400 text-xs mt-1">AI 未配置 — 摘要功能需要 API Key</p>
          <button onClick={openSettings} className="mt-3 text-sm text-blue-600 hover:underline">
            Configure AI Provider / 配置 AI 提供商 →
          </button>
        </div>
      </div>
    );
  }

  // Show post-meeting minutes if available
  if (minutes && !isRecording) {
    return <MinutesPreview minutes={minutes} />;
  }

  // Show generating state
  if (isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <span className="text-3xl animate-spin inline-block">⏳</span>
          <p className="text-zinc-500 text-sm mt-3">Generating meeting minutes... / 正在生成会议纪要...</p>
        </div>
      </div>
    );
  }

  if (minutesError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-red-500 text-sm">{minutesError}</p>
        </div>
      </div>
    );
  }

  // Real-time summaries during recording
  if (summaries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">
            {isRecording
              ? 'Summary will appear after the first interval / 第一个摘要间隔后将出现摘要'
              : 'Start recording to generate summaries / 开始录音以生成摘要'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {summaries.map(s => <SummaryCard key={s.id} summary={s} />)}
    </div>
  );
}

function SummaryCard({ summary }: { summary: RealtimeSummary }) {
  const fmt = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (summary.isLoading) {
    return (
      <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-center">
        <span className="text-sm animate-pulse text-zinc-400">Generating summary... / 生成摘要中...</span>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700"
      style={{ animation: 'fadeIn 0.3s ease-in' }}>
      <p className="text-[10px] text-zinc-400 mb-2">
        {fmt(summary.periodStart)} — {fmt(summary.periodEnd)}
      </p>

      {summary.keyPoints.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
            Key Points / 要点
          </p>
          {summary.keyPoints.map((p, i) => (
            <p key={i} className="text-xs text-zinc-500 pl-2 border-l-2 border-blue-300 mb-1">{p}</p>
          ))}
        </div>
      )}

      {summary.decisions.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
            Decisions / 决策
          </p>
          {summary.decisions.map((d, i) => (
            <p key={i} className="text-xs text-zinc-500 pl-2 border-l-2 border-green-300 mb-1">{d}</p>
          ))}
        </div>
      )}

      {summary.actionItems.length > 0 && (
        <div className="mb-2">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
            Action Items / 待办
          </p>
          {summary.actionItems.map((a, i) => (
            <p key={i} className="text-xs text-zinc-500 pl-2 border-l-2 border-amber-300 mb-1">
              <span className="font-medium">{a.assignee}</span>: {a.task}
              {a.deadline && <span className="text-zinc-400"> ({a.deadline})</span>}
            </p>
          ))}
        </div>
      )}

      {summary.openQuestions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-500 mb-1">
            Open Questions / 未解决
          </p>
          {summary.openQuestions.map((q, i) => (
            <p key={i} className="text-xs text-zinc-500 pl-2 border-l-2 border-red-300 mb-1">{q}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function MinutesPreview({ minutes }: { minutes: MeetingMinutes }) {
  const handleExportMd = async () => {
    try {
      await exportMarkdown(minutes);
    } catch (err) {
      console.error('Export MD failed:', err);
    }
  };

  const handleExportDocx = async () => {
    try {
      await exportWord(minutes);
    } catch (err) {
      console.error('Export DOCX failed:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {/* Export buttons */}
      <div className="flex gap-2">
        <button onClick={handleExportMd}
          className="flex-1 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700
            text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Export Markdown / 导出 MD
        </button>
        <button onClick={handleExportDocx}
          className="flex-1 py-2 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700
            text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Export Word / 导出 Word
        </button>
      </div>

      {/* Title */}
      <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{minutes.title}</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
          {minutes.executiveSummary}
        </p>
      </div>

      {/* Topics */}
      {minutes.topics?.map((t, i) => (
        <div key={i} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1">{t.title}</h4>
          <p className="text-xs text-zinc-500 mb-2">{t.discussion}</p>
          {t.keyPoints?.map((p, j) => (
            <p key={j} className="text-xs text-zinc-500 pl-2 border-l-2 border-blue-300 mb-0.5">{p}</p>
          ))}
          {t.decisions?.map((d, j) => (
            <p key={j} className="text-xs text-green-600 pl-2 border-l-2 border-green-300 mb-0.5 mt-1">{d}</p>
          ))}
        </div>
      ))}

      {/* Action Items */}
      {minutes.actionItems?.length > 0 && (
        <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
          <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-2">
            Action Items / 待办事项
          </h4>
          {minutes.actionItems.map((a, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className={`text-[9px] px-1 rounded ${
                a.priority === 'high' ? 'bg-red-100 text-red-600' :
                a.priority === 'medium' ? 'bg-amber-100 text-amber-600' :
                'bg-zinc-100 text-zinc-500'
              }`}>{a.priority}</span>
              <div>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{a.assignee}: </span>
                <span className="text-xs text-zinc-500">{a.task}</span>
                {a.deadline && <span className="text-[10px] text-zinc-400 ml-1">({a.deadline})</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Open Questions */}
      {minutes.openQuestions?.length > 0 && (
        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-bold text-red-500 mb-1">Open Questions / 未解决</h4>
          {minutes.openQuestions.map((q, i) => (
            <p key={i} className="text-xs text-zinc-500 mb-0.5">• {q}</p>
          ))}
        </div>
      )}

      {/* Next steps */}
      {minutes.nextSteps && (
        <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Next Steps / 下一步</h4>
          <p className="text-xs text-zinc-500">{minutes.nextSteps}</p>
          {minutes.nextMeetingSuggestion && (
            <p className="text-xs text-blue-600 mt-1">{minutes.nextMeetingSuggestion}</p>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-zinc-400 text-center py-2">
        Generated by AI. Please verify key information. / AI 辅助生成，请核实关键信息。
      </p>
    </div>
  );
}
