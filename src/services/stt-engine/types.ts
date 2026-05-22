// ============================================================
// STT (Speech-to-Text) Engine Interface / 语音识别引擎统一接口
// Currently shipped: Deepgram (streaming WebSocket, webm/opus),
// OpenAI Whisper API (segment-based REST, ~5s segments), iFlytek
// (PCM streaming WebSocket, audio/L16;rate=16000). Local Whisper
// is planned — whisper.cpp integration is TODO. Alibaba Speech
// (Paraformer) was previously listed but is removed until a real
// implementation lands.
// ============================================================

/** Supported STT engine IDs */
export type STTEngineId =
  | 'deepgram'        // Deepgram (global) — stable, streaming WebSocket
  | 'whisper_api'     // OpenAI Whisper API — stable, segment-based REST
  | 'xfyun'           // iFlytek (China) — stable, PCM streaming WebSocket
  | 'local_whisper';  // Local Whisper.cpp (offline) — planned, not yet usable

/**
 * Implementation status — used to gate UI and warn users honestly.
 * `beta` is still a legal value (engines that work but have rough edges)
 * but no engine currently uses it; both incomplete engines are 'planned'
 * because they cannot complete a real session today.
 */
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

/**
 * How audio bytes arrive at `feedAudio`.
 *
 * - `stream` (default): the capture layer pushes raw MediaRecorder
 *   chunks roughly every 250 ms. Chunks share a webm container — only
 *   the first one has the header — so each individual chunk is NOT a
 *   self-contained audio file. Engines using a streaming WebSocket
 *   protocol that accepts webm/opus (Deepgram) take this form
 *   directly.
 * - `segment`: capture spawns a parallel MediaRecorder for each
 *   `segmentDurationMs` window and `feedAudio` receives one complete,
 *   independently-decodable webm file per window. Engines using a
 *   REST transcription API (Whisper API) need this form because each
 *   request must carry a standalone audio file.
 * - `pcm-stream`: capture attaches an AudioWorklet to the MediaStream
 *   and pushes raw 16-kHz mono PCM Float32 frames every ~250 ms.
 *   Engines that require uncompressed PCM (iFlytek IAT, with its
 *   audio/L16;rate=16000 frame format) take this form. The engine is
 *   responsible for re-encoding Float32 → Int16 + base64 as required
 *   by its wire format.
 */
export type AudioDeliveryMode = 'stream' | 'segment' | 'pcm-stream';

/** STT Engine interface */
export interface STTEngine {
  readonly id: STTEngineId;
  readonly name: string;
  readonly region: 'global' | 'china' | 'local';
  readonly supportsRealtime: boolean;

  /**
   * How this engine wants to receive audio. Capture reads this on
   * `startSession` to decide whether to push streaming chunks or
   * spawn a segment recorder. Omitted = `'stream'`.
   */
  readonly audioMode?: AudioDeliveryMode;
  /** Only meaningful when `audioMode === 'segment'`. Required in that mode. */
  readonly segmentDurationMs?: number;

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
    description: '高精度，多语言，5 秒分段',
    descriptionEn: 'High accuracy, 99 languages, ~5s segments',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://platform.openai.com/api-keys',
    pricing: '$0.006/min',
    strengths: ['High accuracy', '99 languages', 'Auto language detection', 'Segment-based — works for any meeting length'],
    status: 'stable',
  },
  {
    id: 'xfyun',
    name: '讯飞语音',
    nameEn: 'iFlytek Speech',
    region: 'china',
    description: '中文识别率最高，支持方言，16-kHz PCM 实时流',
    descriptionEn: 'Best Chinese recognition, dialect support, 16-kHz PCM streaming',
    requiresApiKey: true,
    apiKeyGuideUrl: 'https://console.xfyun.cn/services/iat',
    pricing: 'Free 500h/year',
    strengths: ['Best Chinese accuracy', 'Dialect support', 'Large free tier', 'Real-time streaming'],
    status: 'stable',
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

/**
 * Single source of truth for whether a user is allowed to actively select an
 * STT engine. Engines with status === 'planned' are skeletons only and would
 * silently fall back to demo mode at runtime; do not let users pick them.
 */
export function isSelectableSTTEngine(id: string | undefined | null): id is STTEngineId {
  if (!id) return false;
  const info = STT_ENGINE_INFO.find(e => e.id === id);
  return !!info && info.status !== 'planned';
}

/**
 * Region-appropriate default fallback when a stored engine is invalid.
 *
 * Returns the most region-native engine that is currently selectable
 * (`status !== 'planned'`). If that engine is planned today (e.g. iFlytek
 * before its auth signing is implemented), falls back through a stable
 * candidate list rather than handing the caller an unusable default.
 * Guaranteed to return an id for which isSelectableSTTEngine is true so
 * long as the codebase contains at least one stable engine.
 */
export function getDefaultSTTEngineForRegion(region: 'global' | 'china' | null | undefined): STTEngineId {
  const preference: STTEngineId[] = region === 'china'
    ? ['xfyun', 'deepgram', 'whisper_api']
    : ['deepgram', 'whisper_api'];
  for (const candidate of preference) {
    if (isSelectableSTTEngine(candidate)) return candidate;
  }
  // Last resort: scan the full registry for any stable engine. This branch
  // should be unreachable in a shipped build (CI invariants require at least
  // one stable engine to exist), but keeping it makes the function total.
  const anyStable = STT_ENGINE_INFO.find(e => e.status === 'stable');
  return anyStable?.id ?? 'deepgram';
}

/**
 * Decide whether an engine should appear in the picker for a given region.
 *
 * - `local` engines always show.
 * - `global` engines always show.
 * - `china` engines show for China users only.
 *
 * Note this is a UI filter, not a selectability filter — planned engines
 * still appear (badged) so users see the roadmap, but they cannot be
 * activated; that gate is `isSelectableSTTEngine`. The reason we don't
 * hide China-region engines for Global users is the inverse case: if
 * China's only native engine becomes planned (today: xfyun), Global users
 * are unaffected, but China users would have *zero* visible engines if we
 * applied a symmetric filter — so China users see Global engines too as
 * fallback. This asymmetry is intentional.
 */
export function isSTTEngineVisibleForRegion(
  engine: { region: 'global' | 'china' | 'local' },
  region: 'global' | 'china' | null | undefined,
): boolean {
  if (engine.region === 'local') return true;
  if (engine.region === 'global') return true;
  // engine.region === 'china'
  return region === 'china';
}

/** Result of migrating a persisted STT configuration. */
export interface STTMigrationResult {
  /** The engine the app should use now (always selectable). */
  engine: STTEngineId;
  /** API keys after dropping entries for removed / planned engines. */
  apiKeys: Partial<Record<STTEngineId, string>>;
  /** Engine IDs whose stored non-empty key was discarded; callers must
   *  persist a deletion for each so the store doesn't keep orphan secrets. */
  prunedKeys: string[];
  /** True iff the resolved engine differs from the persisted value. */
  engineChanged: boolean;
}

/**
 * Normalize a persisted STT configuration written by an earlier version of
 * the app. Pure function; takes the raw stored values and returns what
 * should be in memory plus a list of side effects the caller must persist.
 *
 * Three classes of legacy values are handled:
 *  - missing / unknown engine id  → fall back to the region default
 *  - engine id removed from the union (e.g. `aliyun_speech`) → same
 *  - engine id still in the union but `status === 'planned'` (e.g.
 *    `local_whisper`) → same; persisting it would let the runtime hit the
 *    stub path
 *
 * Orphan key entries (keys for engines we no longer accept) are dropped
 * from the returned map and listed in `prunedKeys` so the caller can issue
 * the corresponding deletions against the encrypted store. Empty / missing
 * keys are silently ignored — only actually-set secrets need pruning.
 */
export function migrateSTTConfig(
  storedEngine: string | undefined | null,
  storedKeys: Record<string, string> | undefined | null,
  region: 'global' | 'china' | null | undefined,
): STTMigrationResult {
  const engine: STTEngineId = isSelectableSTTEngine(storedEngine)
    ? storedEngine
    : getDefaultSTTEngineForRegion(region);
  const engineChanged = storedEngine !== engine;

  const apiKeys: Partial<Record<STTEngineId, string>> = {};
  const prunedKeys: string[] = [];
  for (const [id, key] of Object.entries(storedKeys || {})) {
    if (isSelectableSTTEngine(id)) {
      apiKeys[id] = key;
    } else if (key) {
      prunedKeys.push(id);
    }
  }

  return { engine, apiKeys, prunedKeys, engineChanged };
}
