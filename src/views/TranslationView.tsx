// ============================================================
// TranslationView — Real-time bilingual translation display
// Shows original + translated text side by side
// Bilingual UI: English / Chinese
// ============================================================

import { useEffect, useRef } from 'react';
import { useTranslationStore } from '../stores/translation-store';
import { useSettingsStore } from '../stores/settings-store';
import type { TranslationEntry } from '../services/translation';

export default function TranslationView() {
  const entries = useTranslationStore((s) => s.entries);
  const active = useTranslationStore((s) => s.active);
  const hasAiKey = useSettingsStore((s) => !!s.aiConfig.apiKeys[s.aiConfig.defaultProvider]);
  const openSettings = useSettingsStore((s) => s.openSettingsModal);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (!hasAiKey) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">
            AI not configured — translation requires an API Key
          </p>
          <p className="text-zinc-400 text-xs mt-1">
            AI 未配置 — 翻译功能需要 API Key
          </p>
          <button onClick={openSettings}
            className="mt-3 text-sm text-blue-600 hover:underline">
            Configure AI Provider / 配置 AI 提供商 →
          </button>
        </div>
      </div>
    );
  }

  if (!active && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">
            Start recording to see real-time translations
          </p>
          <p className="text-zinc-400 text-xs mt-1">
            开始录音后将显示实时翻译
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {active && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50
          border-b border-zinc-200 dark:border-zinc-700 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-zinc-500">Live Translation / 实时翻译</span>
          <span className="ml-auto text-zinc-400">{entries.length} translated</span>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {entries.map((entry) => (
          <TranslationCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function TranslationCard({ entry }: { entry: TranslationEntry }) {
  const dirLabel = entry.sourceLang === 'en' ? 'EN → 中' : '中 → EN';
  const dirColor = entry.sourceLang === 'en'
    ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
    : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400';

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3"
      style={{ animation: 'fadeIn 0.3s ease-in' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        {entry.speaker && (
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {entry.speaker}
          </span>
        )}
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${dirColor}`}>
          {dirLabel}
        </span>
        {entry.isStreaming && (
          <span className="text-[9px] text-zinc-400 animate-pulse">translating...</span>
        )}
      </div>

      {/* Original text (small, muted) */}
      <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed mb-1">
        {entry.originalText}
      </p>

      {/* Translated text (prominent) */}
      <p className={`text-sm leading-relaxed ${
        entry.isStreaming
          ? 'text-zinc-500 dark:text-zinc-400'
          : 'text-zinc-800 dark:text-zinc-200'
      }`}>
        {entry.translatedText || (entry.isStreaming ? '...' : '')}
      </p>
    </div>
  );
}
