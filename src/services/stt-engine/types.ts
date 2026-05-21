// ============================================================
// STT (Speech-to-Text) Engine Interface / 语音识别引擎统一接口
// Supports: Deepgram, Whisper API, iFlytek, Alibaba, local Whisper
// ============================================================

/** Supported STT engine IDs */
export type STTEngineId =
  | 'deepgram'        // Deepgram (global) — stable
  | 'whisper_api'     // OpenAI Whisper API — stable
  | 'xfyun'           // iFlytek (China) — beta (auth signature incomplete)
  | 'local_whisper';  // Local Whisper.cpp (offline) — planned, not yet usable

/** Implementation status — used to gate UI and warn users honestly */
export type STTEngineStatus = 'stable' | 'beta' | 'planned';

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
  /** Implementation status. 'beta'/'planned' engines must be clearly marked in UI. */
  status: STTEngineStatus;
  /** Short note shown when status is 'beta' or 'planned' (bilingual, " / "-separated) */
  statusNote?: string;
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
    status: 'stable',
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
    status: 'stable',
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
    status: 'beta',
    statusNote: 'WebSocket auth signing incomplete — connection may fail / WebSocket 鉴权签名未完整实现，可能连接失败',
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
    status: 'planned',
    statusNote: 'whisper.cpp integration not yet shipped / whisper.cpp 集成尚未发布',
  },
];
