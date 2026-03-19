// ============================================================
// Legal Disclaimer / 法律声明 — Must be shown on first launch
// Bilingual: English first, Chinese second
// ============================================================

import { useState } from 'react';
import {
  LEGAL_SECTIONS,
  CONSENT_CHECKBOX_EN,
  CONSENT_CHECKBOX_ZH,
} from '../config/legal-texts';

interface LegalDisclaimerProps {
  onAccept: () => void;
}

export default function LegalDisclaimer({ onAccept }: LegalDisclaimerProps) {
  const [checked, setChecked] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom) setScrolledToBottom(true);
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900 p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">
          Legal Notice & Terms of Use
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          法律声明与使用条款
        </p>
      </div>

      <div
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto border border-zinc-200 dark:border-zinc-700
          rounded-xl p-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300
          bg-zinc-50 dark:bg-zinc-800 space-y-6"
      >
        {LEGAL_SECTIONS.map((section, i) => (
          <section key={i}>
            {/* English */}
            <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
              {section.titleEn}
            </h2>
            <p className="whitespace-pre-line mb-3">{section.bodyEn}</p>

            {/* Chinese */}
            <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
              {section.titleZh}
            </h2>
            <p className="whitespace-pre-line mb-2">{section.bodyZh}</p>

            {section.isWarning && (
              <div className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
                p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-xs mt-2">
                Warning: Recording laws vary significantly by jurisdiction. Violations may constitute a criminal offense.
                <br />
                警告：不同地区录音法律差异很大，违反可能构成违法行为。
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {!scrolledToBottom && (
          <p className="text-xs text-center text-zinc-400">
            ↓ Please scroll to read the full terms / 请滚动阅读完整条款
          </p>
        )}

        <label className={`flex items-start gap-3 cursor-pointer select-none
          ${!scrolledToBottom ? 'opacity-50 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-blue-600
              focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {CONSENT_CHECKBOX_EN}
            <br />
            <span className="text-zinc-500">{CONSENT_CHECKBOX_ZH}</span>
          </span>
        </label>

        <button
          onClick={onAccept}
          disabled={!checked}
          className="w-full py-3 rounded-xl font-semibold text-base transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-blue-600 text-white hover:bg-blue-700"
        >
          Agree & Continue / 同意并继续
        </button>
      </div>
    </div>
  );
}
