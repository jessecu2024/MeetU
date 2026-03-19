// ============================================================
// AI Provider 统一接口定义
// 所有 AI 提供商（Claude, GPT, Gemini, DeepSeek, Qwen, MiniMax, GLM）
// 都必须实现此接口。业务代码只依赖此接口，不依赖具体实现。
// ============================================================

/** 支持的 AI 提供商 ID */
export type AIProviderId =
  | 'claude'      // Anthropic Claude
  | 'openai'      // OpenAI GPT
  | 'gemini'      // Google Gemini
  | 'deepseek'    // DeepSeek（国内可用）
  | 'qwen'        // 通义千问（阿里，国内可用）
  | 'minimax'     // MiniMax（国内可用）
  | 'glm';        // 智谱 GLM（国内可用）

/** 可用区域 */
export type RegionAvailability = 'global' | 'china' | 'both';

/** 模型选项 */
export interface ModelOption {
  id: string;              // 模型 ID，如 'claude-sonnet-4-20250514'
  name: string;            // 显示名称，如 'Claude Sonnet 4'
  tier: 'fast' | 'balanced' | 'powerful';  // 性能层级
  contextWindow: number;   // 上下文窗口大小（tokens）
  inputPrice: number;      // 输入价格 $/M tokens
  outputPrice: number;     // 输出价格 $/M tokens
  recommended?: boolean;   // 是否推荐
}

/** 消息格式 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 聊天选项 */
export interface ChatOptions {
  model?: string;          // 覆盖默认模型
  temperature?: number;    // 温度 0-1
  maxTokens?: number;      // 最大输出 tokens
  stream?: boolean;        // 是否流式
}

/** 聊天响应 */
export interface ChatResponse {
  content: string;         // 回复内容
  model: string;           // 使用的模型
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;       // 响应延迟
}

/** 流式聊天事件 */
export interface StreamEvent {
  type: 'text_delta' | 'done' | 'error';
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  model?: string;
}

/** ⭐ AI Provider 统一接口 — 所有提供商必须实现 */
export interface AIProvider {
  /** 唯一标识 */
  readonly id: AIProviderId;

  /** 显示名称（中文） */
  readonly name: string;

  /** 显示名称（英文） */
  readonly nameEn: string;

  /** 可用区域 */
  readonly region: RegionAvailability;

  /** 官网地址（用于引导用户注册获取 API Key） */
  readonly website: string;

  /** API Key 获取指引链接 */
  readonly apiKeyGuideUrl: string;

  /** 可用模型列表 */
  readonly models: ModelOption[];

  /** 当前选中的模型 ID */
  currentModel: string;

  /** 设置 API Key */
  setApiKey(key: string): void;

  /** 验证 API Key 是否有效 */
  validateApiKey(key: string): Promise<boolean>;

  /** 测试连接（发送简单请求） */
  testConnection(): Promise<ConnectionTestResult>;

  /** 普通聊天（等待完整响应） */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /** 流式聊天（逐字返回） */
  streamChat(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamEvent>;
}

/** AI Provider 的静态配置信息（用于 UI 展示，不含运行时状态） */
export interface AIProviderInfo {
  id: AIProviderId;
  name: string;
  nameEn: string;
  region: RegionAvailability;
  website: string;
  apiKeyGuideUrl: string;
  description: string;       // 一句话描述
  icon: string;              // icon 文件名或 emoji
  models: ModelOption[];
  defaultModel: string;
}

/** 功能用途类型 — 不同功能可以使用不同的 AI Provider */
export type AIFunction = 'translation' | 'mention_detect' | 'speech_suggest' | 'summary' | 'post_meeting';

/** 用户的 AI 配置 */
export interface UserAIConfig {
  /** 默认 AI 提供商 */
  defaultProvider: AIProviderId;

  /** 各功能可单独指定不同的提供商（可选，不指定则用默认） */
  functionOverrides?: Partial<Record<AIFunction, AIProviderId>>;

  /** 各提供商的 API Key */
  apiKeys: Partial<Record<AIProviderId, string>>;

  /** 各提供商选择的模型 */
  selectedModels: Partial<Record<AIProviderId, string>>;
}
