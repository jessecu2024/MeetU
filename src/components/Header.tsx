// ============================================================
// Header Component — Recording Controls + Audio Status
// Bilingual: English first, Chinese second
// ============================================================

import { useSettingsStore } from '../stores/settings-store';
import { useMeetingStore } from '../stores/meeting-store';
import { STT_ENGINE_INFO, isSelectableSTTEngine } from '../services/stt-engine/types';

export default function Header() {
  const openSettings = useSettingsStore((s) => s.openSettingsModal);
  const defaultProvider = useSettingsStore((s) => s.aiConfig.defaultProvider);
  const hasAiKey = useSettingsStore((s) => !!s.aiConfig.apiKeys[s.aiConfig.defaultProvider]);
  const aiTestResult = useSettingsStore((s) => s.aiTestResults[s.aiConfig.defaultProvider]);
  const sttEngineId = useSettingsStore((s) => s.sttEngine);
  const hasSttKey = useSettingsStore((s) => !!s.sttApiKeys[s.sttEngine]);
  const sttTestResult = useSettingsStore((s) => s.sttTestResult);
  const sttEngineInfo = STT_ENGINE_INFO.find(e => e.id === sttEngineId);
  // STT badge should show "not configured" unless the engine is selectable
  // (rules out planned engines) AND either has a key OR doesn't need one.
  // Previously this hard-coded `local_whisper` as keyless/usable, which was
  // wrong because local_whisper is planned today.
  const sttConfigured =
    isSelectableSTTEngine(sttEngineId) &&
    (hasSttKey || sttEngineInfo?.requiresApiKey === false);
  const {
    isRecording, recordingDuration, currentVolume,
    micActive, useMock,
    sttMock, audioError, bluetoothDetected, deviceLabel,
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
            onClick={() => {
              console.log('[UI] Record button clicked, isRecording:', isRecording, 'showSaveConfirm:', showSaveConfirm);
              if (isRecording) { stopRecording(); } else { requestStartRecording(); }
            }}
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

        {/* Service status indicators — always visible */}
        {!isRecording && !showSaveConfirm && !lastSaveResult && (
          <div className="flex items-center gap-2 mt-2">
            {/* AI Provider status */}
            <button
              onClick={() => openSettings('ai')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                !hasAiKey
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  : aiTestResult?.status === 'ok'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100'
                    : aiTestResult?.status === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100'
                      : aiTestResult?.status === 'testing'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100'
              }`}
              title={aiTestResult?.error || (hasAiKey ? 'Click to open AI settings' : 'No API Key')}
            >
              {aiTestResult?.status === 'testing' ? (
                <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
              ) : !hasAiKey ? (
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              ) : aiTestResult?.status === 'ok' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              ) : aiTestResult?.status === 'error' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
              AI: {!hasAiKey ? 'Not configured' : defaultProvider.charAt(0).toUpperCase() + defaultProvider.slice(1)}
              {hasAiKey && aiTestResult?.status === 'ok' && ' ✓'}
              {hasAiKey && aiTestResult?.status === 'error' && ' ✗'}
            </button>

            {/* STT Engine status */}
            <button
              onClick={() => openSettings('stt')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                !sttConfigured
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  : sttTestResult?.status === 'ok'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100'
                    : sttTestResult?.status === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100'
                      : sttTestResult?.status === 'testing'
                        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100'
              }`}
              title={sttTestResult?.error || 'Click to open STT settings'}
            >
              {sttTestResult?.status === 'testing' ? (
                <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
              ) : !sttConfigured ? (
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              ) : sttTestResult?.status === 'ok' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              ) : sttTestResult?.status === 'error' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
              STT: {STT_ENGINE_INFO.find(e => e.id === sttEngineId)?.nameEn || sttEngineId}
              {sttTestResult?.status === 'ok' && ' ✓'}
              {sttTestResult?.status === 'error' && ' ✗'}
            </button>
          </div>
        )}

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
              <span className={micActive ? 'text-green-600' : 'text-red-500'}>
                {micActive
                  ? `🎤 ${deviceLabel ? deviceLabel.substring(0, 25) : 'Active'} ✓`
                  : '🎤 No audio ✗'}
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

            {bluetoothDetected && (
              <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-2 py-1.5">
                Bluetooth detected. For meeting audio, enable Stereo Mix in Settings.
                <span className="block text-blue-500 mt-0.5">检测到蓝牙。如需录制会议声音，请在设置中启用立体声混音。</span>
              </p>
            )}

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
