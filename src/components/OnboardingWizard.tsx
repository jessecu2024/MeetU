// ============================================================
// 引导流程（纯 BYOK 版本）
// 法律声明已通过后进入此流程
// 步骤：选区域 → 选 AI → 输入 Key → 测试 → 选 STT → 用户信息 → 完成
// ============================================================

import { useState } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { providerRegistry } from '../services/ai-provider';
import type { AIProviderId } from '../services/ai-provider/types';
import type { STTEngineId } from '../services/stt-engine/types';
import { STT_ENGINE_INFO } from '../services/stt-engine/types';

const STEPS = [
  { title: '选择你的网络环境', subtitle: '决定哪些 AI 服务可用' },
  { title: '选择 AI 提供商', subtitle: '使用你自己的 API Key 连接' },
  { title: '输入你的 API Key', subtitle: 'Key 仅加密存储在本地设备' },
  { title: '连接测试', subtitle: '验证你的 API 配置' },
  { title: '选择语音识别引擎', subtitle: '将会议音频转为文字' },
  { title: '告诉我们你的信息', subtitle: '用于检测你被@提问' },
];

const PROVIDER_CARDS: Record<string, Array<{
  id: AIProviderId; name: string; desc: string;
  badge?: string; pricing: string;
}>> = {
  global: [
    { id: 'claude', name: 'Claude (Anthropic)', desc: '翻译和摘要质量最高', badge: '推荐', pricing: '输入 $3/M · 输出 $15/M' },
    { id: 'openai', name: 'OpenAI GPT', desc: '生态最广，兼容性最好', pricing: '输入 $2.5/M · 输出 $10/M' },
    { id: 'gemini', name: 'Google Gemini', desc: '上下文窗口超大', pricing: '输入 $0.1/M · 输出 $0.4/M' },
    { id: 'deepseek', name: 'DeepSeek', desc: '性价比极高，国内外可用', badge: '省钱', pricing: '输入 $0.27/M · 输出 $1.1/M' },
  ],
  china: [
    { id: 'deepseek', name: 'DeepSeek（深度求索）', desc: '性价比最高，国内外都可用', badge: '推荐', pricing: '输入 ¥1/M · 输出 ¥4/M' },
    { id: 'qwen', name: '通义千问（阿里）', desc: '中文理解能力强', pricing: '输入 ¥2/M · 输出 ¥6/M' },
    { id: 'glm', name: '智谱 GLM', desc: '快速模型有免费额度', badge: '有免费额度', pricing: 'Flash 免费 · Plus ¥5/M' },
    { id: 'minimax', name: 'MiniMax', desc: '百万 token 长上下文', pricing: '输入 ¥1/M · 输出 ¥8/M' },
  ],
};

export default function OnboardingWizard() {
  const store = useSettingsStore();
  const [step, setStep] = useState(0);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testLatency, setTestLatency] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const goNext = () => { if (step < STEPS.length - 1) setStep(step + 1); else store.completeOnboarding(); };
  const goBack = () => { if (step > 0) setStep(step - 1); };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const provider = providerRegistry.get(store.aiConfig.defaultProvider);
      if (!provider) throw new Error('提供商未找到');
      const result = await provider.testConnection();
      if (result.ok) {
        setTestStatus('success');
        setTestLatency(result.latencyMs);
      } else {
        setTestStatus('error');
        setTestError(result.error || '连接失败');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : '未知错误');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-zinc-900">
      {/* Progress */}
      <div className="px-6 pt-5 flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
            i <= step ? 'bg-blue-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
        ))}
      </div>

      {/* Header */}
      <div className="px-6 pt-4 pb-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
          {STEPS[step].title}
        </h2>
        <p className="text-sm text-zinc-500 mt-0.5">{STEPS[step].subtitle}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">

        {/* Step 0: 选区域 */}
        {step === 0 && (
          <div className="space-y-3">
            {([
              { region: 'global' as const, emoji: '🌍', title: '海外网络', desc: '可访问 Google、OpenAI、Anthropic' },
              { region: 'china' as const, emoji: '🇨🇳', title: '中国大陆网络', desc: '推荐 DeepSeek、通义千问等' },
            ]).map(({ region, emoji, title, desc }) => (
              <button key={region}
                onClick={() => { store.setUserRegion(region); goNext(); }}
                className={`w-full p-4 rounded-xl border text-left transition-all hover:border-blue-400 ${
                  store.userRegion === region
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'}`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{emoji}</span>
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-white">{title}</p>
                    <p className="text-sm text-zinc-500">{desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: 选 AI */}
        {step === 1 && store.userRegion && (
          <div className="space-y-2.5">
            {PROVIDER_CARDS[store.userRegion].map((p) => (
              <button key={p.id}
                onClick={() => { store.setDefaultProvider(p.id); goNext(); }}
                className={`w-full p-4 rounded-xl border text-left transition-all hover:border-blue-400 ${
                  store.aiConfig.defaultProvider === p.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-zinc-200 dark:border-zinc-700'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-white">{p.name}</span>
                      {p.badge && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {p.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500 mt-0.5">{p.desc}</p>
                    <p className="text-xs text-zinc-400 mt-1">{p.pricing}</p>
                  </div>
                </div>
              </button>
            ))}

            <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20
              border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                🔑 本应用使用你自己的 API Key 直接调用 AI 服务。
                AI 费用由你与服务商直接结算，我们不经手。
              </p>
            </div>
          </div>
        )}

        {/* Step 2: 输入 API Key — 不允许跳过 */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {providerRegistry.get(store.aiConfig.defaultProvider)?.name} API Key
              </label>
              <input
                type="password"
                placeholder="sk-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600
                  bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white
                  focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <a href={providerRegistry.get(store.aiConfig.defaultProvider)?.apiKeyGuideUrl}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
              📋 前往获取 API Key →
            </a>

            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500">
                🔒 Key 仅加密存储在你的本地设备上，不会发送到我们的服务器。
                所有 AI 请求直接从你的设备发往 AI 服务商。
              </p>
            </div>

            <button
              onClick={() => {
                store.setApiKey(store.aiConfig.defaultProvider, apiKeyInput);
                const provider = providerRegistry.get(store.aiConfig.defaultProvider);
                if (provider) provider.setApiKey(apiKeyInput);
                goNext();
              }}
              disabled={!apiKeyInput.trim()}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium
                disabled:opacity-40 disabled:cursor-not-allowed
                hover:bg-blue-700 transition-colors">
              下一步：测试连接
            </button>

            {/* 允许跳过 AI Key 但明确说明后果 */}
            <button onClick={goNext}
              className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600">
              暂时跳过（翻译/摘要/发言建议功能将不可用）
            </button>
          </div>
        )}

        {/* Step 3: 测试连接 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className={`p-6 rounded-xl border text-center ${
              testStatus === 'success' ? 'border-green-300 bg-green-50 dark:bg-green-900/20' :
              testStatus === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-900/20' :
              'border-zinc-200 dark:border-zinc-700'}`}>
              {testStatus === 'idle' && (
                <><div className="text-4xl mb-3">🔌</div>
                <p className="text-zinc-600 dark:text-zinc-400">点击测试与 AI 服务的连接</p></>
              )}
              {testStatus === 'testing' && (
                <><div className="text-4xl mb-3 animate-spin">⏳</div>
                <p className="text-zinc-600 dark:text-zinc-400">连接中...</p></>
              )}
              {testStatus === 'success' && (
                <><div className="text-4xl mb-3">✅</div>
                <p className="text-green-700 dark:text-green-300 font-medium">连接成功！</p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  延迟 {testLatency}ms · {providerRegistry.get(store.aiConfig.defaultProvider)?.name}
                </p></>
              )}
              {testStatus === 'error' && (
                <><div className="text-4xl mb-3">❌</div>
                <p className="text-red-700 dark:text-red-300 font-medium">连接失败</p>
                <p className="text-sm text-red-500 mt-1">{testError}</p>
                <p className="text-xs text-red-400 mt-2">请检查 Key 是否正确、网络是否可达</p></>
              )}
            </div>

            {testStatus !== 'success' && (
              <button onClick={handleTest} disabled={testStatus === 'testing'}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium
                  disabled:opacity-50 hover:bg-blue-700 transition-colors">
                {testStatus === 'testing' ? '测试中...' : testStatus === 'error' ? '重新测试' : '开始测试'}
              </button>
            )}

            <button onClick={goNext}
              className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                testStatus === 'success'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
              {testStatus === 'success' ? '继续 →' : '跳过'}
            </button>
          </div>
        )}

        {/* Step 4: 选 STT */}
        {step === 4 && (
          <div className="space-y-2.5">
            {STT_ENGINE_INFO
              .filter(e =>
                store.userRegion === 'china'
                  ? e.region === 'china' || e.region === 'local'
                  : e.region === 'global' || e.region === 'local')
              .map((engine) => (
                <button key={engine.id}
                  onClick={() => store.setSTTEngine(engine.id as STTEngineId)}
                  className={`w-full p-4 rounded-xl border text-left transition-all hover:border-blue-400 ${
                    store.sttEngine === engine.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-zinc-200 dark:border-zinc-700'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-white">{engine.name}</p>
                      <p className="text-sm text-zinc-500">{engine.description}</p>
                      <p className="text-xs text-zinc-400 mt-1">{engine.pricing}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {engine.region === 'local' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">离线</span>
                      )}
                      {!engine.requiresApiKey && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">无需 Key</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}

            <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20
              border border-green-200 dark:border-green-800">
              <p className="text-sm text-green-800 dark:text-green-300">
                💡 选择「本地 Whisper」可在无网络时使用基础转写功能，
                且完全免费、数据不出本机。
              </p>
            </div>

            <button onClick={goNext}
              className="w-full mt-2 py-2.5 rounded-lg bg-blue-600 text-white font-medium
                hover:bg-blue-700 transition-colors">
              继续 →
            </button>
          </div>
        )}

        {/* Step 5: 用户信息 */}
        {step === 5 && (
          <div className="space-y-4">
            {[
              { key: 'name', label: '你的中文名', placeholder: '如：张明' },
              { key: 'nameEn', label: '你的英文名', placeholder: '如：Michael Zhang' },
              { key: 'role', label: '你的职位/角色', placeholder: '如：产品经理' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {label}
                </label>
                <input type="text" placeholder={placeholder}
                  value={(store.userProfile as Record<string, string>)[key] || ''}
                  onChange={(e) => store.updateUserProfile({ [key]: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-600
                    bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}

            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500">
                💡 这些信息用于检测别人是否在叫你/问你问题。
                AI 会据此准备更贴切的回复建议。所有信息仅存储在本地。
              </p>
            </div>

            <button onClick={() => store.completeOnboarding()}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold
                hover:bg-blue-700 transition-colors text-base">
              🚀 开始使用
            </button>
          </div>
        )}
      </div>

      {/* Footer nav */}
      {step > 0 && (
        <div className="px-6 pb-5">
          <button onClick={goBack}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← 返回上一步
          </button>
        </div>
      )}
    </div>
  );
}
