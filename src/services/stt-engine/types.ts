// ============================================================
// STT (Speech-to-Text) Engine Interface / 语音识别引擎统一接口
// Supports: Deepgram, Whisper API, iFlytek, Alibaba, local Whisper
// ============================================================

/** Supported STT engine IDs */
export type STTEngineId =
  | 'deepgram'        // Deepgram (global)
  | 'whisper_api'     // OpenAI Whisper API
  | 'xfyun'           // iFlytek (China)
  | 'aliyun_speech'   // Alibaba Speech (China)
  | 'local_whisper';  // Local Whisper.cpp (offline)

/** STT configuration */
export interface STTConfig {
  sampleRate: number;
  language?: string;
  enableDiarization?: boolean;
  enablePunctuation?: boolean;
  interimResults?: boolean;
}

/** Transcript result */
export interface TranscriptResult {
  id: string;
  text: string;
  isFinal: boolean;
  speaker?: string;
  language?: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

/** STT engine info for UI display */
export interface STTEngineInfo {
  id: STTEngineId;
  name: string;
  nameEn: string;
  region: 'global' | 'china' | 'local';
  description: string;
  descriptionEn: string;
  requiresApiKey: boolean;
  apiKeyGuideUrl?: string;
  pricing: string;
  strengths: string[];
}

/** STT Engine interface */
export interface STTEngine {
  readonly id: STTEngineId;
  readonly name: string;
  readonly region: 'global' | 'china' | 'local';
  readonly supportsRealtime: boolean;

  setApiKey(key: string): void;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  startSession(config: STTConfig): Promise<void>;
  feedAudio(chunk: ArrayBuffer): void;
  onTranscript(callback: (result: TranscriptResult) => void): void;
  stopSession(): Promise<void>;
  isRunning(): boolean;
}

/** All engine static info (bilingual) */
export const STT_ENGINE_INFO: STTEngineInfo[] = [
  {
    id: 'deepgram',
    name: 'Deepgram',
    nameEn: 'Deepgram',
    region: 'global',
    description: '延迟低、精度高，英文最佳',
    descriptionEn: 'Low latency, high accuracy, best for English',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://console.deepgram.com/signup',
    pricing: '$0.0043/min (Pay-as-you-go)',
    strengths: ['Ultra-low latency ~300ms', 'Real-time streaming', 'Speaker diarization', 'Multi-language'],
  },
  {
    id: 'whisper_api',
    name: 'Whisper API (OpenAI)',
    nameEn: 'Whisper API (OpenAI)',
    region: 'global',
    description: '高精度，多语言，延迟略高',
    descriptionEn: 'High accuracy, 99 languages, slightly higher latency',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://platform.openai.com/api-keys',
    pricing: '$0.006/min',
    strengths: ['High accuracy', '99 languages', 'Auto language detection'],
  },
  {
    id: 'xfyun',
    name: '讯飞语音',
    nameEn: 'iFlytek Speech',
    region: 'china',
    description: '中文识别率最高，支持方言',
    descriptionEn: 'Best Chinese recognition, dialect support',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://console.xfyun.cn/services/iat',
    pricing: 'Free 500h/year',
    strengths: ['Best Chinese accuracy', 'Dialect support', 'Large free tier', 'Real-time streaming'],
  },
  {
    id: 'aliyun_speech',
    name: '阿里语音 (Paraformer)',
    nameEn: 'Alibaba Speech (Paraformer)',
    region: 'china',
    description: '中文优秀，与通义千问同生态',
    descriptionEn: 'Excellent Chinese, same ecosystem as Qwen',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://nls-portal.console.aliyun.com/',
    pricing: 'Free tier + ¥1.8/hr',
    strengths: ['Excellent Chinese', 'Alibaba Cloud ecosystem', 'Paraformer model'],
  },
  {
    id: 'local_whisper',
    name: '本地 Whisper（离线）',
    nameEn: 'Local Whisper (Offline)',
    region: 'local',
    description: '完全离线，无需网络，隐私最佳',
    descriptionEn: 'Fully offline, no network needed, best privacy',
    requiresApiKey: false,
    pricing: 'Free (requires GPU or Apple Silicon)',
    strengths: ['Fully offline', 'Zero cost', 'Data never leaves device', 'Best privacy'],
  },
];
