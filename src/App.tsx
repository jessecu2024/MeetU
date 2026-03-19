// ============================================================
// App Root Component
// 流程: 法律声明 → 引导设置(BYOK) → 主界面
// ============================================================

import { useEffect } from 'react';
import { useSettingsStore } from './stores/settings-store';
import { initializeProviders } from './services/ai-provider';
import LegalDisclaimer from './components/LegalDisclaimer';
import OnboardingWizard from './components/OnboardingWizard';

export default function App() {
  const legalAccepted = useSettingsStore((s) => s.legalAccepted);
  const acceptLegal = useSettingsStore((s) => s.acceptLegal);
  const isFirstLaunch = useSettingsStore((s) => s.isFirstLaunch);

  useEffect(() => {
    initializeProviders();
  }, []);

  // Step 1: 法律声明（必须首先同意）
  if (!legalAccepted) {
    return <LegalDisclaimer onAccept={acceptLegal} />;
  }

  // Step 2: 首次引导（选 AI、输入 Key 等）
  if (isFirstLaunch) {
    return <OnboardingWizard />;
  }

  // Step 3: 主界面
  return (
    <div className="h-screen flex flex-col items-center justify-center
      bg-white dark:bg-zinc-900 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">
          AI Meeting Assistant
        </h1>
        <p className="text-zinc-500 mb-6">
          设置完成！主界面开发中...
        </p>
        <div className="space-y-2 text-sm text-zinc-400">
          <p>✅ 法律声明已同意</p>
          <p>✅ AI 提供商已配置（BYOK）</p>
          <p>✅ STT 引擎已选择</p>
          <p>⏳ 音频捕获模块（ScreenCaptureKit / WASAPI）</p>
          <p>⏳ 实时转写界面</p>
        </div>
      </div>
    </div>
  );
}
