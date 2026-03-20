// ============================================================
// TranscriptView — Real-time captions display
// Shows live STT results with speaker, language, timestamps
// Bilingual UI: English / Chinese
// ============================================================

import { useEffect, useRef } from 'react';
import { useTranscriptStore, type TranscriptEntry } from '../stores/transcript-store';
import { useSettingsStore } from '../stores/settings-store';

export default function TranscriptView() {
  const entries = useTranscriptStore((s) => s.entries);
  const isMockMode = useTranscriptStore((s) => s.isMockMode);
  const activeEngine = useTranscriptStore((s) => s.activeEngineId);
  const openSettings = useSettingsStore((s) => s.openSettingsModal);
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
              ? <><span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30
                  text-amber-700 dark:text-amber-400 font-medium mr-1">Demo</span>
                  Simulated meeting / 模拟会议演示</>
              : `Live: ${activeEngine}`}
          </span>
          <span className="ml-auto text-zinc-400">
            {entries.filter(e => e.isFinal).length} segments
          </span>
        </div>
      )}

      {/* Demo mode banner */}
      {isMockMode && isRecording && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20
          border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Demo Mode: Showing simulated data. To transcribe real audio, configure an STT engine in Settings → Speech Engine.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
            演示模式：显示模拟数据。如需转写真实音频，请在设置→语音引擎中配置 STT。
          </p>
          <button
            onClick={() => openSettings('stt')}
            className="mt-1.5 text-xs px-2.5 py-1 rounded-md bg-amber-600 text-white
              hover:bg-amber-700 transition-colors font-medium"
          >
            Configure STT / 配置语音引擎
          </button>
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
