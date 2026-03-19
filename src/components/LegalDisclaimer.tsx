// ============================================================
// 法律声明组件 — 首次启动时必须展示
// 用户必须阅读并同意后才能进入应用
// ============================================================

import { useState } from 'react';

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
          法律声明与使用条款
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Legal Notice & Terms of Use
        </p>
      </div>

      <div
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto border border-zinc-200 dark:border-zinc-700
          rounded-xl p-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300
          bg-zinc-50 dark:bg-zinc-800"
      >
        <section className="mb-5">
          <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
            1. 录音合规责任
          </h2>
          <p className="mb-2">
            本应用可以捕获您设备上的系统音频并进行录制。在使用本功能前，您有责任确保：
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-2">
            <li>已遵守您所在地区关于录音的法律法规</li>
            <li>已获得所有会议参与者的知情同意（如适用法律要求）</li>
            <li>不会将录音用于违反他人隐私权的目的</li>
          </ul>
          <p className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
            p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            ⚠️ 不同地区的录音法律差异很大。例如：部分地区要求所有参与者同意才能合法录音；
            部分地区只需录音者一方同意。违反录音法律可能构成违法行为，请务必了解您所在地区的具体规定。
          </p>
        </section>

        <section className="mb-5">
          <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
            2. 数据处理说明
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>您的音频数据和文字内容<strong>仅存储在您的本地设备上</strong></li>
            <li>当您使用 AI 翻译/摘要等功能时，相关文本将发送至
              <strong>您自行选择和付费的第三方 AI 服务商</strong>（如 Anthropic、OpenAI、DeepSeek 等）</li>
            <li>本应用不存储、不传输、不访问您的任何数据</li>
            <li>各 AI 服务的数据处理政策由对应服务商负责，请您自行了解</li>
          </ul>
        </section>

        <section className="mb-5">
          <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
            3. API Key 安全
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>您的 API Key 通过加密方式存储在您的本地设备上</li>
            <li>本应用不会将您的 API Key 发送至我们的服务器</li>
            <li>AI 请求直接从您的设备发往您选择的 AI 服务商</li>
            <li>API 使用费用由您与对应 AI 服务商之间直接结算</li>
          </ul>
        </section>

        <section className="mb-2">
          <h2 className="font-semibold text-zinc-900 dark:text-white mb-2">
            4. 免责声明
          </h2>
          <p>
            本软件是一个<strong>个人笔记辅助工具</strong>。使用本软件录音、转写、翻译所产生的
            一切法律后果由用户自行承担。软件提供方不对用户的使用方式承担任何法律责任。
            AI 生成的翻译、摘要和发言建议仅供参考，不构成专业意见。
          </p>
        </section>
      </div>

      <div className="mt-4 space-y-3">
        {!scrolledToBottom && (
          <p className="text-xs text-center text-zinc-400">
            ↓ 请滚动阅读完整条款
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
            我已阅读并理解以上条款，确认自行承担录音合规责任，
            并了解 AI 功能需使用我自己的 API Key
          </span>
        </label>

        <button
          onClick={onAccept}
          disabled={!checked}
          className="w-full py-3 rounded-xl font-semibold text-base transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-blue-600 text-white hover:bg-blue-700"
        >
          同意并继续
        </button>
      </div>
    </div>
  );
}
