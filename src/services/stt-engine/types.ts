// ============================================================
// STT (Speech-to-Text) 引擎统一接口
// 支持 Deepgram, Whisper API, 讯飞, 本地 Whisper 等
// ============================================================

/** 支持的 STT 引擎 ID */
export type STTEngineId =
  | 'deepgram'        // Deepgram（海外推荐）
  | 'whisper_api'     // OpenAI Whisper API
  | 'xfyun'           // 讯飞语音（国内推荐）
  | 'aliyun_speech'   // 阿里语音（国内）
  | 'local_whisper';  // 本地 Whisper.cpp（离线）

/** STT 配置 */
export interface STTConfig {
  sampleRate: number;        // 采样率，通常 16000
  language?: string;         // 语言 hint（可选，auto-detect）
  enableDiarization?: boolean; // 是否启用说话人分离
  enablePunctuation?: boolean; // 是否自动插入标点
  interimResults?: boolean;    // 是否返回中间结果
}

/** 转写结果 */
export interface TranscriptResult {
  id: string;                  // 唯一 ID
  text: string;                // 转写文本
  isFinal: boolean;            // 是否为最终结果（false = 中间结果）
  speaker?: string;            // 说话人标识
  language?: string;           // 检测到的语言
  startMs: number;             // 开始时间戳（毫秒）
  endMs: number;               // 结束时间戳（毫秒）
  confidence: number;          // 置信度 0-1
}

/** STT 引擎信息（用于 UI 展示） */
export interface STTEngineInfo {
  id: STTEngineId;
  name: string;
  nameEn: string;
  region: 'global' | 'china' | 'local';
  description: string;
  requiresApiKey: boolean;
  apiKeyGuideUrl?: string;
  pricing: string;             // 价格描述
  strengths: string[];         // 优势
}

/** ⭐ STT 引擎统一接口 */
export interface STTEngine {
  readonly id: STTEngineId;
  readonly name: string;
  readonly region: 'global' | 'china' | 'local';
  readonly supportsRealtime: boolean;

  /** 设置 API Key */
  setApiKey(key: string): void;

  /** 测试连接 */
  testConnection(): Promise<{ ok: boolean; error?: string }>;

  /** 开始实时转写会话 */
  startSession(config: STTConfig): Promise<void>;

  /** 喂入音频数据 */
  feedAudio(chunk: ArrayBuffer): void;

  /** 注册转写结果回调 */
  onTranscript(callback: (result: TranscriptResult) => void): void;

  /** 停止会话 */
  stopSession(): Promise<void>;

  /** 是否正在运行 */
  isRunning(): boolean;
}

/** 所有引擎的静态信息 */
export const STT_ENGINE_INFO: STTEngineInfo[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    nameEn: 'Deepgram',
    region: 'global',
    description: '延迟低、精度高，英文最佳',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://console.deepgram.com/signup',
    pricing: '$0.0043/分钟（Pay-as-you-go）',
    strengths: ['超低延迟 ~300ms', '流式实时转写', '说话人分离', '多语言支持'],
  },
  {
    id: 'whisper_api',
    name: 'Whisper API (OpenAI)',
    nameEn: 'Whisper API',
    region: 'global',
    description: '高精度，多语言，延迟略高',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://platform.openai.com/api-keys',
    pricing: '$0.006/分钟',
    strengths: ['高精度', '99种语言', '自动语言检测'],
  },
  {
    id: 'xfyun',
    name: '讯飞语音',
    nameEn: 'iFlytek Speech',
    region: 'china',
    description: '中文识别率最高，支持方言',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://console.xfyun.cn/services/iat',
    pricing: '免费500小时/年',
    strengths: ['中文识别率最高', '支持方言', '免费额度大', '实时流式'],
  },
  {
    id: 'aliyun_speech',
    name: '阿里语音 (Paraformer)',
    nameEn: 'Alibaba Speech',
    region: 'china',
    description: '中文优秀，与通义千问同生态',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://nls-portal.console.aliyun.com/',
    pricing: '免费额度 + ¥1.8/小时',
    strengths: ['中文优秀', '阿里云生态', 'Paraformer 模型'],
  },
  {
    id: 'local_whisper',
    name: '本地 Whisper（离线）',
    nameEn: 'Local Whisper (Offline)',
    region: 'local',
    description: '完全离线，无需网络，隐私最佳',
    requiresApiKey: false,
    pricing: '免费（需要 GPU 或 Apple Silicon）',
    strengths: ['完全离线', '零成本', '数据不出本机', '隐私最佳'],
  },
];
