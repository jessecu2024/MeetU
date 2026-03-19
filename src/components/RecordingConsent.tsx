// ============================================================
// 录音前同意提醒 — 每次开始录音时显示
// ============================================================

import { useState } from 'react';

interface RecordingConsentProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function RecordingConsent({ onConfirm, onCancel }: RecordingConsentProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-xl mx-4 max-w-sm w-full p-5">
        <div className="text-center mb-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30
            flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
            准备开始录音
          </h3>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center mb-4 leading-relaxed">
          请确保您已获得所有会议参与者的同意。
          根据您所在地区的法律，未经同意录音可能违法。
        </p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer select-none
          justify-center">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-zinc-300 text-blue-600 cursor-pointer"
          />
          <span className="text-xs text-zinc-500">本次会话不再提醒</span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
              border border-zinc-200 dark:border-zinc-600
              text-zinc-600 dark:text-zinc-400
              hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm()}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            已确认，开始录音
          </button>
        </div>
      </div>
    </div>
  );
}
