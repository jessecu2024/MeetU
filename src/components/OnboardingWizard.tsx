// ============================================================
// Onboarding Wizard / 引导流程 (Bilingual, Pure BYOK)
// Steps: Region → AI Provider → API Key → Test → STT → User Info
// ============================================================

import { useState, useMemo } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { providerRegistry } from '../services/ai-provider';
import type { AIProviderId } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';
import { STT_ENGINE_INFO } from '../services/stt-engine/types';

/** API Key format patterns for pre-validation (no network request) */
const API_KEY_PATTERNS: Record<AIProviderId, { pattern: RegExp; hint: string; hintZh: string; placeholder: string }> = {
  claude: { pattern: /^sk-ant-[a-zA-Z0-9_-]{20,}$/, hint: 'Should start with "sk-ant-"', hintZh: '应以 "sk-ant-" 开头', placeholder: 'sk-ant-...' },
  openai: { pattern: /^sk-[a-zA-Z0-9_-]{20,}$/, hint: 'Should start with "sk-"', hintZh: '应以 "sk-" 开头', placeholder: 'sk-...' },
  gemini: { pattern: /^AIza[a-zA-Z0-9_-]{20,}$/, hint: 'Should start with "AIza"', hintZh: '应以 "AIza" 开头', placeholder: 'AIza...' },
  deepseek: { pattern: /^sk-[a-zA-Z0-9_-]{20,}$/, hint: 'Should start with "sk-"', hintZh: '应以 "sk-" 开头', placeholder: 'sk-...' },
  qwen: { pattern: /^.{20,}$/, hint: 'At least 20 characters', hintZh: '至少 20 个字符', placeholder: 'your-api-key' },
  minimax: { pattern: /^.{20,}$/, hint: 'At least 20 characters', hintZh: '至少 20 个字符', placeholder: 'your-api-key' },
  glm: { pattern: /^.{20,}$/, hint: 'At least 20 characters', hintZh: '至少 20 个字符', placeholder: 'your-api-key' },
};

const STEPS = [
  { en: 'Choose Your Network', zh: '选择你的网络环境', subEn: 'Determines which AI services are available', subZh: '决定哪些 AI 服务可用' },
  { en: 'Choose AI Provider', zh: '选择 AI 提供商', subEn: 'Connect with your own API Key (BYOK)', subZh: '使用你自己的 API Key 连接' },
  { en: 'Enter Your API Key', zh: '输入你的 API Key', subEn: 'Key is encrypted and stored locally only', subZh: 'Key 仅加密存储在本地设备' },
  { en: 'Connection Test', zh: '连接测试', subEn: 'Verify your API configuration', subZh: '验证你的 API 配置' },
  { en: 'Choose STT Engine', zh: '选择语音识别引擎', subEn: 'Convert meeting audio to text', subZh: '将会议音频转为文字' },
  { en: 'Your Profile', zh: '告诉我们你的信息', subEn: 'Used to detect when you are mentioned', subZh: '用于检测你被 @ 提问' },
];

const PROVIDER_CARDS: Record<string, Array<{
  id: AIProviderId; name: string; desc: string; descZh: string;
  badge?: string; badgeZh?: string; pricing: string;
}>> = {
  global: [
    { id: 'claude', name: 'Claude (Anthropic)', desc: 'Best translation & summary quality', descZh: '翻译和摘要质量最高', badge: 'Recommended', badgeZh: '推荐', pricing: 'In $3/M · Out $15/M' },
    { id: 'openai', name: 'OpenAI GPT', desc: 'Widest ecosystem & compatibility', descZh: '生态最广，兼容性最好', pricing: 'In $2.5/M · Out $10/M' },
    { id: 'gemini', name: 'Google Gemini', desc: 'Largest context window', descZh: '上下文窗口超大', pricing: 'In $0.1/M · Out $0.4/M' },
    { id: 'deepseek', name: 'DeepSeek', desc: 'Best value, works globally', descZh: '性价比极高，国内外可用', badge: 'Best Value', badgeZh: '省钱', pricing: 'In $0.27/M · Out $1.1/M' },
  ],
  china: [
    { id: 'deepseek', name: 'DeepSeek', desc: 'Best value, works in China & globally', descZh: '性价比最高，国内外都可用', badge: 'Recommended', badgeZh: '推荐', pricing: 'In ¥1/M · Out ¥4/M' },
    { id: 'qwen', name: 'Qwen (Alibaba)', desc: 'Strong Chinese language understanding', descZh: '中文理解能力强', pricing: 'In ¥2/M · Out ¥6/M' },
    { id: 'glm', name: 'Zhipu GLM', desc: 'Fast model with free tier', descZh: '快速模型有免费额度', badge: 'Free Tier', badgeZh: '有免费额度', pricing: 'Flash Free · Plus ¥5/M' },
    { id: 'minimax', name: 'MiniMax', desc: '1M token context window', descZh: '百万 token 长上下文', pricing: 'In ¥1/M · Out ¥8/M' },
  ],
};

export default function OnboardingWizard() {
  const store = useSettingsStore();
  const [step, setStep] = useState(0);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testLatency, setTestLatency] = useState(0);
  const [testModel, setTestModel] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const currentProviderId = store.aiConfig.defaultProvider;
  const keyPattern = API_KEY_PATTERNS[currentProviderId];
  const keyFormatValid = useMemo(() => {
    if (!apiKeyInput.trim()) return null; // empty = no validation yet
    return keyPattern.pattern.test(apiKeyInput.trim());
  }, [apiKeyInput, keyPattern]);

  const goNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else store.completeOnboarding();
  };
  const goBack = () => { if (step > 0) setStep(step - 1); };
  const handleExit = () => {
    const confirmed = window.confirm(
      'Exit setup? You can finish later in Settings.\n退出设置？你可以稍后在设置中完成。'
    );
    if (confirmed) store.completeOnboarding();
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');
    setTestModel('');
    try {
      const provider = providerRegistry.get(store.aiConfig.defaultProvider);
      if (!provider) throw new Error('Provider not found / 提供商未找到');
      console.log(`[AI Test] Testing ${provider.name} (${provider.id})...`);
      const result = await provider.testConnection();
      console.log(`[AI Test] Result:`, result);
      if (result.ok) {
        setTestStatus('success');
        setTestLatency(result.latencyMs);
        setTestModel(result.model || provider.currentModel);
        store.setConnectionStatus(store.aiConfig.defaultProvider, 'connected');
      } else {
        setTestStatus('error');
        setTestError(result.error || 'Connection failed / 连接失败');
        store.setConnectionStatus(store.aiConfig.defaultProvider, 'failed');
      }
    } catch (err) {
      console.error('[AI Test] Exception:', err);
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Unknown error / 未知错误');
    }
  };

  const currentStep = STEPS[step];

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      {/* Top nav: Back + Close */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1 flex-shrink-0">
        {step > 0 ? (
          <button onClick={goBack}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Back / 返回
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={handleExit}
          className="w-8 h-8 rounded-lg flex items-center justify-center
            hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 text-sm"
          title="Exit setup / 退出设置"
        >
          ✕
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-6 pt-1 flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
            i <= step ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
        ))}
      </div>

      {/* Header */}
      <div className="px-6 pt-4 pb-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
          {currentStep.en}
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">{currentStep.zh}</p>
        <p className="text-sm text-zinc-400 mt-1">{currentStep.subEn} / {currentStep.subZh}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">

        {/* Step 0: Region */}
        {step === 0 && (
          <div className="space-y-3">
            {([
              { region: 'global' as const, title: 'Global Network', titleZh: '海外网络', desc: 'Access Google, OpenAI, Anthropic', descZh: '可访问 Google、OpenAI、Anthropic' },
              { region: 'china' as const, title: 'China Mainland', titleZh: '中国大陆网络', desc: 'Recommended: DeepSeek, Qwen, etc.', descZh: '推荐 DeepSeek、通义千问等' },
            ]).map(({ region, title, titleZh, desc, descZh }) => (
              <button key={region}
                onClick={() => { store.setUserRegion(region); goNext(); }}
                className={`w-full p-4 rounded-xl border text-left transition-all hover:border-blue-400 ${
                  store.userRegion === region
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'}`}>
                <p className="font-medium text-zinc-900 dark:text-white">{title}</p>
                <p className="text-xs text-zinc-500">{titleZh}</p>
                <p className="text-sm text-zinc-400 mt-1">{desc} / {descZh}</p>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: Choose AI Provider */}
        {step === 1 && store.userRegion && (
          <div className="space-y-2.5">
            {PROVIDER_CARDS[store.userRegion].map((p) => {
              const connStatus = store.getConnectionStatus(p.id);
              const statusDot = connStatus === 'connected' ? '🟢'
                : connStatus === 'failed' ? '🔴'
                : connStatus === 'untested' ? '🟡'
                : '⚪';
              return (
              <button key={p.id}
                onClick={() => { store.setDefaultProvider(p.id); goNext(); }}
                className={`w-full p-4 rounded-xl border text-left transition-all hover:border-blue-400 ${
                  store.aiConfig.defaultProvider === p.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm" title={connStatus}>{statusDot}</span>
                      <span className="font-medium text-zinc-900 dark:text-white">{p.name}</span>
                      {p.badge && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {p.badge} / {p.badgeZh}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500 mt-0.5">{p.desc}</p>
                    <p className="text-xs text-zinc-400">{p.descZh}</p>
                    <p className="text-xs text-zinc-400 mt-1">{p.pricing}</p>
                  </div>
                </div>
              </button>
              );
            })}

            <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20
              border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                This app uses YOUR API Key to call AI services directly. AI costs are settled between you and the service provider.
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                本应用使用你自己的 API Key 直接调用 AI 服务，费用由你与服务商直接结算。
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Enter API Key */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {providerRegistry.get(currentProviderId)?.name} API Key
              </label>
              <input
                type="password"
                placeholder={keyPattern.placeholder}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className={`w-full px-3 py-2.5 rounded-lg border
                  bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white
                  focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  keyFormatValid === false
                    ? 'border-amber-400 dark:border-amber-500'
                    : keyFormatValid === true
                      ? 'border-green-400 dark:border-green-500'
                      : 'border-zinc-300 dark:border-zinc-600'
                }`} />
              {keyFormatValid === false && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                  This doesn't look like a valid {providerRegistry.get(currentProviderId)?.nameEn} API Key. {keyPattern.hint}
                  <span className="block text-amber-500">
                    这不像有效的 {providerRegistry.get(currentProviderId)?.name} API Key。{keyPattern.hintZh}
                  </span>
                </p>
              )}
              {keyFormatValid === true && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1.5">
                  Format looks good / 格式正确
                </p>
              )}
            </div>

            <a href={providerRegistry.get(currentProviderId)?.apiKeyGuideUrl}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
              Get API Key / 前往获取 API Key →
            </a>

            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500">
                Your Key is encrypted and stored locally only. It is never sent to our servers. All AI requests go directly from your device to the AI provider.
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                Key 仅加密存储在你的本地设备上，不会发送到我们的服务器。所有 AI 请求直接从你的设备发往 AI 服务商。
              </p>
            </div>

            <button
              onClick={() => {
                const trimmedKey = apiKeyInput.trim();
                store.setApiKey(currentProviderId, trimmedKey);
                const provider = providerRegistry.get(currentProviderId);
                if (provider) provider.setApiKey(trimmedKey);
                goNext();
              }}
              disabled={!apiKeyInput.trim()}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium
                disabled:opacity-40 disabled:cursor-not-allowed
                hover:bg-blue-700 transition-colors">
              Next: Test Connection / 下一步：测试连接
            </button>

            <button onClick={goNext}
              className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600">
              Skip for now (Translation/Summary/Speech features will be disabled)
              <span className="block text-zinc-400">暂时跳过（翻译/摘要/发言建议功能将不可用）</span>
            </button>
          </div>
        )}

        {/* Step 3: Connection Test */}
        {step === 3 && (
          <div className="space-y-4">
            <div className={`p-6 rounded-xl border text-center ${
              testStatus === 'success' ? 'border-green-300 bg-green-50 dark:bg-green-900/20' :
              testStatus === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-900/20' :
              'border-zinc-200 dark:border-zinc-700'}`}>
              {testStatus === 'idle' && (
                <>
                  <div className="text-4xl mb-3">🔌</div>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Click to test your AI service connection
                  </p>
                  <p className="text-xs text-zinc-400">点击测试与 AI 服务的连接</p>
                </>
              )}
              {testStatus === 'testing' && (
                <>
                  <div className="text-4xl mb-3">
                    <span className="inline-block animate-spin">⏳</span>
                  </div>
                  <p className="text-zinc-600 dark:text-zinc-400 font-medium">
                    Testing... / 测试中...
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Sending test request to {providerRegistry.get(currentProviderId)?.nameEn}...
                  </p>
                </>
              )}
              {testStatus === 'success' && (
                <>
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-green-700 dark:text-green-300 font-medium">
                    Connected! / 连接成功！
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                    Latency: {testLatency}ms / 延迟: {testLatency}ms
                  </p>
                  <p className="text-xs text-green-500 dark:text-green-500 mt-0.5">
                    Model: {testModel} · {providerRegistry.get(currentProviderId)?.name}
                  </p>
                </>
              )}
              {testStatus === 'error' && (
                <>
                  <div className="text-4xl mb-3">❌</div>
                  <p className="text-red-700 dark:text-red-300 font-medium">
                    Connection Failed / 连接失败
                  </p>
                  <p className="text-sm text-red-500 dark:text-red-400 mt-1 break-words px-2">{testError}</p>
                  <p className="text-xs text-red-400 dark:text-red-500 mt-2">
                    Please check your API Key and network / 请检查 API Key 和网络连接
                  </p>
                </>
              )}
            </div>

            {testStatus !== 'success' && (
              <button onClick={handleTest} disabled={testStatus === 'testing'}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium
                  disabled:opacity-50 hover:bg-blue-700 transition-colors">
                {testStatus === 'testing'
                  ? 'Testing... / 测试中...'
                  : testStatus === 'error'
                    ? 'Retry / 重新测试'
                    : 'Start Test / 开始测试'}
              </button>
            )}

            <button onClick={goNext}
              className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                testStatus === 'success'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              {testStatus === 'success' ? 'Continue / 继续 →' : 'Skip / 跳过'}
            </button>
          </div>
        )}

        {/* Step 4: Choose STT Engine */}
        {step === 4 && (
          <div className="space-y-2.5">
            {STT_ENGINE_INFO
              .filter(e =>
                store.userRegion === 'china'
                  ? e.region === 'china' || e.region === 'local'
                  : e.region === 'global' || e.region === 'local')
              .map((engine) => {
                const isPlanned = engine.status === 'planned';
                const isBeta = engine.status === 'beta';
                return (
                  <button key={engine.id}
                    onClick={() => !isPlanned && store.setSTTEngine(engine.id as STTEngineId)}
                    disabled={isPlanned}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      isPlanned ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400'
                    } ${
                      store.sttEngine === engine.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-200 dark:border-zinc-700'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-zinc-900 dark:text-white">{engine.nameEn}</p>
                        <p className="text-xs text-zinc-500">{engine.name}</p>
                        <p className="text-sm text-zinc-400 mt-0.5">
                          {engine.descriptionEn}
                        </p>
                        <p className="text-xs text-zinc-400">{engine.description}</p>
                        <p className="text-xs text-zinc-400 mt-1">{engine.pricing}</p>
                        {(isBeta || isPlanned) && engine.statusNote && (
                          <p className={`text-xs mt-1.5 ${isPlanned ? 'text-zinc-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            ⚠ {engine.statusNote}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 ml-2 shrink-0">
                        {isPlanned && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                            Planned
                          </span>
                        )}
                        {isBeta && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Beta
                          </span>
                        )}
                        {engine.region === 'local' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            Offline / 离线
                          </span>
                        )}
                        {!engine.requiresApiKey && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            No Key
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}

            <div className="mt-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50
              border border-zinc-200 dark:border-zinc-700">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                A fully offline option (Local Whisper) is on the roadmap but not yet shipped. For now pick a cloud STT engine — your audio data still stays on your device, only the transcript request goes to your chosen provider.
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                完全离线方案（本地 Whisper）在路线图中但尚未发布。当前请选择一个云端 STT 引擎 — 你的音频数据仍仅保存在本地，只有转写请求会发送给你选择的服务商。
              </p>
            </div>

            <button onClick={goNext}
              className="w-full mt-2 py-2.5 rounded-lg bg-blue-600 text-white font-medium
                hover:bg-blue-700 transition-colors">
              Continue / 继续 →
            </button>
          </div>
        )}

        {/* Step 5: User Profile */}
        {step === 5 && (
          <div className="space-y-4">
            {[
              { key: 'name', en: 'Your Name (Chinese)', zh: '你的中文名', placeholder: 'e.g. 张明' },
              { key: 'nameEn', en: 'Your English Name', zh: '你的英文名', placeholder: 'e.g. Michael Zhang' },
              { key: 'role', en: 'Your Role / Title', zh: '你的职位/角色', placeholder: 'e.g. Product Manager / 产品经理' },
            ].map(({ key, en, zh, placeholder }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {en} <span className="text-zinc-400 font-normal">/ {zh}</span>
                </label>
                <input type="text" placeholder={placeholder}
                  value={(store.userProfile as unknown as Record<string, string>)[key] || ''}
                  onChange={(e) => store.updateUserProfile({ [key]: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}

            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500">
                This info helps detect when someone mentions you or asks you a question in a meeting.
                All data is stored locally only.
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                这些信息用于检测别人是否在叫你/问你问题。所有信息仅存储在本地。
              </p>
            </div>

            <button onClick={() => store.completeOnboarding()}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold
                hover:bg-blue-700 transition-colors text-base">
              Get Started / 开始使用
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
