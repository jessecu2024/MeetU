// ============================================================
// Header Component — Recording Controls + Audio Status
// Bilingual: English first, Chinese second
// ============================================================

import { useSettingsStore } from '../stores/settings-store';
import { useMeetingStore } from '../stores/meeting-store';

export default function Header() {
  const openSettings = useSettingsStore((s) => s.openSettingsModal);
  const {
    isRecording, recordingDuration, currentVolume,
    systemAudioActive, microphoneActive, useMock,
    audioError, requestStartRecording, stopRecording,
  } = useMeetingStore();

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  return (
    <div className="flex-shrink-0">
      {/* Title bar (draggable) */}
      <div className="drag-region flex items-center justify-between px-4 pt-3 pb-1">
        <div className="no-drag">
          <h1 className="text-sm font-bold text-zinc-900 dark:text-white">
            MeetU <span className="font-normal text-xs text-zinc-400">/ 开会啦</span>
          </h1>
          <p className="text-[9px] text-zinc-400 -mt-0.5">Your AI Meeting Assistant / 你的会议 AI 秘书</p>
        </div>
        <div className="flex items-center gap-1.5 no-drag">
          <button
            onClick={openSettings}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-sm"
            title="Settings / 设置"
          >
            ⚙
          </button>
          <button
            onClick={() => window.electronAPI?.window.minimize()}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-sm"
          >
            —
          </button>
          <button
            onClick={() => window.electronAPI?.window.close()}
            className="w-7 h-7 rounded-lg flex items-center justify-center
              hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-600 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Recording controls */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-3">
          {/* Record / Stop button */}
          <button
            onClick={isRecording ? stopRecording : requestStartRecording}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isRecording ? (
              <>
                <span className="w-3 h-3 rounded-sm bg-white" />
                Stop / 停止
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full bg-red-400" />
                Record / 录音
              </>
            )}
          </button>

          {/* Duration */}
          {isRecording && (
            <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">
              {formatDuration(recordingDuration)}
            </span>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-500">REC</span>
            </span>
          )}
        </div>

        {/* Audio status bar */}
        {isRecording && (
          <div className="mt-2 space-y-1.5">
            {/* Volume meter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-8">Vol</span>
              <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    currentVolume > 0.7 ? 'bg-red-500' :
                    currentVolume > 0.3 ? 'bg-green-500' :
                    'bg-green-400'
                  }`}
                  style={{ width: `${Math.min(100, currentVolume * 100)}%` }}
                />
              </div>
            </div>

            {/* Source status */}
            <div className="flex items-center gap-3 text-xs">
              <span className={microphoneActive ? 'text-green-600' : 'text-zinc-400'}>
                {microphoneActive ? '🎤 Mic ✓' : '🎤 Mic ✗'}
              </span>
              <span className={systemAudioActive ? 'text-green-600' : 'text-zinc-400'}>
                {systemAudioActive ? '🔊 System ✓' : '🔊 System ✗'}
              </span>
              {useMock && (
                <span className="text-amber-500">
                  Mock Mode / 模拟模式
                </span>
              )}
            </div>

            {/* Error or info */}
            {audioError && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
                rounded-lg px-2 py-1">
                {audioError}
              </p>
            )}

            {!systemAudioActive && !useMock && (
              <p className="text-xs text-zinc-400">
                System audio not available — recording microphone only
                <span className="block">系统音频不可用 — 仅录制麦克风</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
