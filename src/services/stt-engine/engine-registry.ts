// ============================================================
// STT Engine Registry
// Manages all STT engine instances, selects based on user config
// ============================================================

import type { STTEngine, STTEngineId } from './types';
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
    this.engines.set('xfyun', new XfyunEngine());
    this.engines.set('local_whisper', new LocalWhisperEngine());
    // aliyun_speech: placeholder, not yet implemented
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
   */
  async getConfiguredEngine(
    preferredId: STTEngineId,
    apiKeys: Partial<Record<STTEngineId, string>>
  ): Promise<{ engine: STTEngine; isMock: boolean }> {
    // Try preferred engine
    const preferred = this.engines.get(preferredId);
    const preferredKey = apiKeys[preferredId];
    if (preferred && preferredKey) {
      preferred.setApiKey(preferredKey);
      return { engine: preferred, isMock: false };
    }

    // Try local whisper (no key needed) — only if model is actually available
    if (preferredId === 'local_whisper') {
      const local = this.engines.get('local_whisper');
      if (local) {
        const test = await local.testConnection().catch(() => ({ ok: false }));
        if (test.ok) return { engine: local, isMock: false };
        // local_whisper is a stub — fall through to mock
        console.log('[STT] local_whisper not available, falling back to demo mode');
      }
    }

    // Try any engine with a configured key
    for (const [id, key] of Object.entries(apiKeys)) {
      if (key) {
        const engine = this.engines.get(id as STTEngineId);
        if (engine) {
          engine.setApiKey(key);
          return { engine, isMock: false };
        }
      }
    }

    // Fall back to mock
    return { engine: this.mockEngine, isMock: true };
  }
}

export const sttRegistry = new STTEngineRegistry();
