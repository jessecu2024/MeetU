// ============================================================
// Header Component — Recording Controls + Audio Status
// Bilingual: English first, Chinese second
// ============================================================

import { useSettingsStore } from '../stores/settings-store';
import { useMeetingStore } from '../stores/meeting-store';

export default function Header() {
  const openSettings = useSettingsStore((s) => s.openSettingsModal);
  const micLabel = useSettingsStore((s) => s.appSettings.micDeviceLabel);
  const sysLabel = useSettingsStore((s) => s.appSettings.sysAudioDeviceLabel);
  const {
    isRecording, recordingDuration, currentVolume,
    micActive, sysActive, useMock,
    sttMock, audioError,
    showSaveConfirm, lastSaveResult,
    requestStartRecording, stopRecording,
    confirmSave, discardRecording, clearSaveResult,
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
      {/* App info + settings */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <p className="text-[9px] text-zinc-400">Your AI Meeting Assistant / 你的会议 AI 秘书</p>
        </div>
        <button
          onClick={openSettings}
          className="w-7 h-7 rounded-lg flex items-center justify-center
            hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 text-sm"
          title="Settings / 设置"
        >
          ⚙
        </button>
      </div>

      {/* Recording controls */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={isRecording ? stopRecording : requestStartRecording}
            disabled={showSaveConfirm}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm transition-all ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            } ${showSaveConfirm ? 'opacity-50 cursor-not-allowed' : ''}`}
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

          {isRecording && (
            <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">
              {formatDuration(recordingDuration)}
            </span>
          )}

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
                    currentVolume > 0.3 ? 'bg-green-500' : 'bg-green-400'
                  }`}
                  style={{ width: `${Math.min(100, currentVolume * 100)}%` }}
                />
              </div>
            </div>

            {/* Source status */}
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className={micActive ? 'text-green-600' : 'text-zinc-400'}>
                {micActive ? '🎤 Mic ✓' : '🎤 Mic ✗'}
              </span>
              <span className={sysActive ? 'text-green-600' : 'text-zinc-400'}>
                {sysActive
                  ? `🔊 ${sysLabel || 'System'} ✓`
                  : sysLabel
                    ? '🔊 System ✗'
                    : '🔊 Not configured'}
              </span>
              {sttMock && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30
                  text-amber-700 dark:text-amber-400 font-medium">
                  Demo Mode / 演示模式
                </span>
              )}
              {useMock && !sttMock && (
                <span className="text-amber-500">Mock Audio</span>
              )}
            </div>

            {audioError && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2 py-1">
                {audioError}
              </p>
            )}
          </div>
        )}

        {/* Audio error when NOT recording (e.g. start failure) */}
        {!isRecording && audioError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {audioError}
          </p>
        )}

        {/* In-app save confirm */}
        {showSaveConfirm && (
          <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
              Save Recording? / 是否保存录音？
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={confirmSave}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                Save / 保存
              </button>
              <button
                onClick={discardRecording}
                className="px-4 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                Discard / 不保存
              </button>
            </div>
          </div>
        )}

        {/* Save result notification */}
        {!isRecording && !showSaveConfirm && lastSaveResult && (
          <div className={`mt-2 px-3 py-2 rounded-lg text-xs ${
            lastSaveResult.saved
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700'
          }`}>
            {lastSaveResult.saved && lastSaveResult.filePath ? (
              <div>
                <p className="text-green-700 dark:text-green-400 font-medium">
                  Recording saved / 录音已保存
                </p>
                <p className="text-green-600 dark:text-green-500 mt-0.5 break-all text-[10px]">
                  {lastSaveResult.filePath}
                </p>
                <button
                  onClick={() => (window.electronAPI as unknown as { file?: { showInFolder?: (p: string) => void } })?.file?.showInFolder?.(lastSaveResult.filePath!)}
                  className="mt-1 px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors">
                  Open Folder / 打开文件夹
                </button>
              </div>
            ) : (
              <p className="text-zinc-500">Recording discarded / 录音已丢弃</p>
            )}
            <button onClick={clearSaveResult}
              className="float-right text-zinc-400 hover:text-zinc-600 text-sm -mt-4">
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
