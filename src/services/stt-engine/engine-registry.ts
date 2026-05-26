// ============================================================
// STT Engine Registry
// Manages all STT engine instances, selects based on user config
// ============================================================

import type { STTEngine, STTEngineId } from './types';
import { isSelectableSTTEngine, STT_ENGINE_INFO } from './types';

/** Whether an engine needs a user-supplied API key. Keyless engines
 *  (local_whisper) must be availability-tested rather than selected
 *  off the mere presence of a (spurious) stored key. Defaults to true
 *  for safety if the id isn't found. */
function engineRequiresKey(id: STTEngineId): boolean {
  const info = STT_ENGINE_INFO.find(e => e.id === id);
  return info ? info.requiresApiKey : true;
}
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
    this.engines.set('xfyun', new XfyunEngine());          // stable — HMAC-SHA256 signing + PCM stream
    this.engines.set('local_whisper', new LocalWhisperEngine()); // beta — smart-whisper (whisper.cpp) + model download
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
   * (currently only `local_whisper` remains in that bucket) or a
   * removed-from-union engine must NEVER be returned with `isMock: false`,
   * because at runtime its `startSession` / `feedAudio` are TODO and the
   * user would silently get no transcripts.
   */
  async getConfiguredEngine(
    preferredId: STTEngineId,
    apiKeys: Partial<Record<STTEngineId, string>>
  ): Promise<{ engine: STTEngine; isMock: boolean }> {
    // 1. Try the user's preferred engine, but only if it's actually usable.
    if (isSelectableSTTEngine(preferredId)) {
      const preferred = this.engines.get(preferredId);
      if (preferred) {
        if (engineRequiresKey(preferredId)) {
          // Key-based engine: a configured key is sufficient to select it.
          const preferredKey = apiKeys[preferredId];
          if (preferredKey) {
            preferred.setApiKey(preferredKey);
            return { engine: preferred, isMock: false };
          }
          // Requires a key but none configured → fall through.
        } else {
          // Keyless engine (local_whisper): a stored "key" is spurious
          // and must NOT bypass the availability check. Confirm the
          // native module + a downloaded model are actually present
          // before claiming non-mock status.
          const test = await preferred.testConnection().catch(() => ({ ok: false }));
          if (test.ok) return { engine: preferred, isMock: false };
          // Not available (module missing / no model) → fall through.
        }
      }
    }

    // 2. Fall back to any other selectable, KEY-BASED engine that has a
    //    configured key. We skip keyless engines here: they're only
    //    chosen as the explicit preferred engine (tested in step 1), so
    //    a stray local_whisper key can't surface it without the
    //    availability check. Skipping non-selectable IDs prevents an
    //    orphan `aliyun_speech` key from surfacing a removed engine.
    for (const [id, key] of Object.entries(apiKeys)) {
      if (!key || !isSelectableSTTEngine(id) || id === preferredId) continue;
      if (!engineRequiresKey(id as STTEngineId)) continue;
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
