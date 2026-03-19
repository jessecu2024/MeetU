// ============================================================
// TranscriptView — Real-time captions display
// Shows live STT results with speaker, language, timestamps
// Bilingual UI: English / Chinese
// ============================================================

import { useEffect, useRef } from 'react';
import { useTranscriptStore, type TranscriptEntry } from '../stores/transcript-store';

export default function TranscriptView() {
  const entries = useTranscriptStore((s) => s.entries);
  const isMockMode = useTranscriptStore((s) => s.isMockMode);
  const activeEngine = useTranscriptStore((s) => s.activeEngineId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isRecording = !!activeEngine;

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (!isRecording && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-zinc-400 text-sm">
            Start recording to see real-time transcription
          </p>
          <p className="text-zinc-400 text-xs mt-1">
            开始录音后将显示实时字幕
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Status bar */}
      {isRecording && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50
          border-b border-zinc-200 dark:border-zinc-700 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-zinc-500">
            {isMockMode
              ? 'Mock Mode — simulated transcription / 模拟模式'
              : `Live: ${activeEngine}`}
          </span>
          <span className="ml-auto text-zinc-400">
            {entries.filter(e => e.isFinal).length} segments
          </span>
        </div>
      )}

      {/* Transcript entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 space-y-1"
      >
        {entries.map((entry, idx) => (
          <TranscriptLine key={`${entry.id}-${idx}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const langBadge = entry.language === 'en' ? 'EN' :
                    entry.language === 'zh' ? '中' :
                    entry.language ? entry.language.toUpperCase() : null;

  return (
    <div
      className={`flex gap-2 py-1.5 rounded-lg px-2 transition-all duration-300 ${
        entry.isFinal
          ? 'bg-transparent'
          : 'bg-blue-50/50 dark:bg-blue-900/10'
      }`}
      style={{ animation: 'fadeIn 0.3s ease-in' }}
    >
      {/* Timestamp */}
      <span className="text-[10px] text-zinc-400 font-mono w-10 flex-shrink-0 pt-0.5">
        {formatTime(entry.startMs)}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          {/* Speaker */}
          {entry.speaker && (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              {entry.speaker}
            </span>
          )}
          {/* Language badge */}
          {langBadge && (
            <span className={`text-[9px] px-1 py-0 rounded font-medium ${
              entry.language === 'en'
                ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
                : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
            }`}>
              {langBadge}
            </span>
          )}
          {/* Confidence indicator */}
          {entry.confidence > 0 && entry.confidence < 0.7 && (
            <span className="text-[9px] text-zinc-400" title="Low confidence / 低置信度">
              ?
            </span>
          )}
        </div>

        {/* Text */}
        <p className={`text-sm leading-relaxed break-words ${
          entry.isFinal
            ? 'text-zinc-800 dark:text-zinc-200'
            : 'text-zinc-400 dark:text-zinc-500 italic'
        }`}>
          {entry.text}
        </p>
      </div>
    </div>
  );
}
