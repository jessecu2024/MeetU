// ============================================================
// Mention Alert — Popup when user is @'d in meeting
// Shows who mentioned you, the question, and jump to Speech tab
// Bilingual UI: English / Chinese
// ============================================================

import { useMentionStore } from '../stores/mention-store';

interface MentionAlertProps {
  onGoToSpeech: () => void;
}

export default function MentionAlert({ onGoToSpeech }: MentionAlertProps) {
  const mention = useMentionStore((s) => s.activeMention);
  const dismiss = useMentionStore((s) => s.dismissAlert);

  if (!mention) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-4 pt-3"
      style={{ animation: 'fadeIn 0.3s ease-in' }}>
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700
        rounded-xl shadow-lg p-4 max-w-sm mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <span className="text-sm font-bold text-red-700 dark:text-red-300">
              You were mentioned! / 有人@你！
            </span>
          </div>
          <button onClick={dismiss}
            className="text-red-400 hover:text-red-600 text-sm">✕</button>
        </div>

        {/* Who and what */}
        <div className="mb-3">
          <p className="text-xs text-red-600 dark:text-red-400 mb-1">
            {mention.speaker || 'Someone'} said:
          </p>
          <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
            {mention.triggerText}
          </p>
          {mention.extractedQuestion && (
            <p className="text-xs text-red-700 dark:text-red-300 mt-1.5 font-medium">
              Question: {mention.extractedQuestion}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={dismiss}
            className="flex-1 py-2 rounded-lg text-xs font-medium border
              border-red-200 dark:border-red-700 text-red-600 dark:text-red-400
              hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors">
            Dismiss / 忽略
          </button>
          <button onClick={() => { dismiss(); onGoToSpeech(); }}
            className="flex-1 py-2 rounded-lg text-xs font-medium
              bg-red-600 text-white hover:bg-red-700 transition-colors">
            View Suggestions / 查看建议 →
          </button>
        </div>
      </div>
    </div>
  );
}
