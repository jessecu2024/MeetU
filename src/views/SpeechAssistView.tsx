// ============================================================
// Speech Assist View — Shows @mentions and reply suggestions
// Bilingual UI: English / Chinese
// ============================================================

import { useMentionStore } from '../stores/mention-store';
import { useSettingsStore } from '../stores/settings-store';
import type { SpeechAdvice, SpeechSuggestion } from '../services/speech-advisor';

export default function SpeechAssistView() {
  const advices = useMentionStore((s) => s.advices);
  const mentions = useMentionStore((s) => s.mentions);
  const hasAiKey = useSettingsStore((s) => !!s.aiConfig.apiKeys[s.aiConfig.defaultProvider]);
  const openSettings = useSettingsStore((s) => s.openSettingsModal);

  if (!hasAiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">
            AI not configured — speech suggestions require an API Key
          </p>
          <p className="text-zinc-400 text-xs mt-1">
            AI 未配置 — 发言建议功能需要 API Key
          </p>
          <button onClick={openSettings}
            className="mt-3 text-sm text-blue-600 hover:underline">
            Configure AI Provider / 配置 AI 提供商 →
          </button>
        </div>
      </div>
    );
  }

  if (mentions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <div className="text-3xl mb-3">🎯</div>
          <p className="text-zinc-400 text-sm">
            No mentions detected yet
          </p>
          <p className="text-zinc-400 text-xs mt-1">
            尚未检测到 @ 你的发言
          </p>
          <p className="text-zinc-300 text-xs mt-3">
            When someone calls your name or asks you a question, suggestions will appear here
          </p>
          <p className="text-zinc-300 text-xs mt-0.5">
            当有人叫你或向你提问时，发言建议会显示在这里
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {advices.map((advice) => (
        <AdviceCard key={advice.id} advice={advice} />
      ))}

      {/* Mentions without advice yet */}
      {mentions
        .filter(m => !advices.some(a => a.mentionId === m.id))
        .map(m => (
          <div key={m.id} className="p-3 rounded-xl border border-amber-200 dark:border-amber-800
            bg-amber-50 dark:bg-amber-900/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-amber-600">
                {m.speaker || 'Someone'} mentioned you / 提到了你
              </span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{m.triggerText}</p>
            <p className="text-xs text-zinc-400 mt-1">
              Generating suggestions... / 正在生成建议...
            </p>
          </div>
        ))}
    </div>
  );
}

function AdviceCard({ advice }: { advice: SpeechAdvice }) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const toneLabels: Record<string, { en: string; zh: string; color: string }> = {
    conservative: { en: 'Conservative', zh: '保守回应', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    assertive: { en: 'Assertive', zh: '积极建议', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    diplomatic: { en: 'Diplomatic', zh: '提问引导', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      style={{ animation: 'fadeIn 0.3s ease-in' }}>
      {/* Trigger context */}
      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-amber-600">
            {advice.triggerSpeaker || 'Someone'}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">@ you</span>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{advice.triggerText}</p>
        {advice.extractedQuestion && (
          <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1 font-medium">
            Q: {advice.extractedQuestion}
          </p>
        )}
      </div>

      {/* Suggestions */}
      <div className="p-3 space-y-2">
        {advice.isLoading ? (
          <div className="text-center py-4">
            <span className="text-xl animate-spin inline-block">⏳</span>
            <p className="text-xs text-zinc-400 mt-2">
              Generating suggestions... / 正在生成建议...
            </p>
          </div>
        ) : advice.error ? (
          <p className="text-xs text-red-500 text-center py-2">{advice.error}</p>
        ) : (
          advice.suggestions.map((s, i) => (
            <SuggestionCard key={i} suggestion={s} toneLabels={toneLabels} onCopy={copyToClipboard} />
          ))
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion: s, toneLabels, onCopy
}: {
  suggestion: SpeechSuggestion;
  toneLabels: Record<string, { en: string; zh: string; color: string }>;
  onCopy: (text: string) => void;
}) {
  const tone = toneLabels[s.tone] || toneLabels.conservative;

  return (
    <div className="p-2.5 rounded-lg border border-zinc-100 dark:border-zinc-700
      hover:border-blue-300 dark:hover:border-blue-700 transition-colors group">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${tone.color}`}>
            {s.label || `${tone.en} / ${tone.zh}`}
          </span>
          {s.confidence > 0 && (
            <span className="text-[9px] text-zinc-400">{s.confidence}%</span>
          )}
        </div>
        <button
          onClick={() => onCopy(s.text)}
          className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800
            text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity
            hover:bg-blue-100 hover:text-blue-600">
          Copy / 复制
        </button>
      </div>
      <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
        {s.text}
      </p>
    </div>
  );
}
