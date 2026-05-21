// ============================================================
// STT Engine Registry
// Manages all STT engine instances, selects based on user config
// ============================================================

import type { STTEngine, STTEngineId } from './types';
import { isSelectableSTTEngine } from './types';
import { DeepgramEngine } from './deepgram-engine';
import { WhisperAPIEngine } from './whisper-api-engine';
import { XfyunEngine } from './xfyun-engine';
import { LocalWhisperEngine } from './local-whisper';
import { MockSTTEngine } from './mock-engine';

class STTEngineRegistry {
  private engines = new Map<STTEngineId, STTEngine>();
  private mockEngine = new MockSTTEngine();

  constructor() {
    this.engines.set('deepgram', new DeepgramEngine());
    this.engines.set('whisper_api', new WhisperAPIEngine());
    this.engines.set('xfyun', new XfyunEngine());          // planned — HMAC-SHA256 signing not yet implemented
    this.engines.set('local_whisper', new LocalWhisperEngine()); // planned — whisper.cpp not yet integrated
  }

  /** Get a specific engine */
  get(id: STTEngineId): STTEngine | undefined {
    return this.engines.get(id);
  }

  /** Get the mock engine */
  getMock(): STTEngine {
    return this.mockEngine;
  }

  /** Set API key for an engine */
  setApiKey(engineId: STTEngineId, key: string): void {
    const engine = this.engines.get(engineId);
    if (engine) engine.setApiKey(key);
  }

  /**
   * Get the best available engine based on user config.
   * Falls back to mock if no engine is configured/available.
   *
   * Every path must respect isSelectableSTTEngine — a planned engine
   * (currently `local_whisper`) or a removed-from-union engine must NEVER
   * be returned with `isMock: false`, because at runtime its `startSession`
   * / `feedAudio` are TODO and the user would silently get no transcripts.
   */
  async getConfiguredEngine(
    preferredId: STTEngineId,
    apiKeys: Partial<Record<STTEngineId, string>>
  ): Promise<{ engine: STTEngine; isMock: boolean }> {
    // 1. Try the user's preferred engine, but only if it's actually usable.
    if (isSelectableSTTEngine(preferredId)) {
      const preferred = this.engines.get(preferredId);
      if (preferred) {
        const preferredKey = apiKeys[preferredId];
        if (preferredKey) {
          preferred.setApiKey(preferredKey);
          return { engine: preferred, isMock: false };
        }
        // No key required (offline engines) — confirm runtime availability
        // before claiming non-mock status.
        const test = await preferred.testConnection().catch(() => ({ ok: false }));
        if (test.ok) return { engine: preferred, isMock: false };
      }
    }

    // 2. Fall back to any other selectable engine that has a configured key.
    //    Skipping non-selectable IDs is what prevents an orphan
    //    `local_whisper` / `aliyun_speech` key from surfacing the stub.
    for (const [id, key] of Object.entries(apiKeys)) {
      if (!key || !isSelectableSTTEngine(id) || id === preferredId) continue;
      const engine = this.engines.get(id as STTEngineId);
      if (engine) {
        engine.setApiKey(key);
        return { engine, isMock: false };
      }
    }

    // 3. Nothing usable — demo mode.
    return { engine: this.mockEngine, isMock: true };
  }
}

export const sttRegistry = new STTEngineRegistry();
