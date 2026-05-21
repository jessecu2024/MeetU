import { describe, it, expect } from 'vitest';
import { WhisperAPIEngine } from './whisper-api-engine';

describe('WhisperAPIEngine.startSession (defense-in-depth)', () => {
  it('refuses to start a session — the engine expects PCM but production capture sends webm/opus', async () => {
    // Regression guard: even if some caller bypasses isSelectableSTTEngine
    // and the engine-registry / store guards, the engine itself refuses to
    // run. Without this throw, the engine would happily accept webm/opus
    // bytes via feedAudio, treat them as PCM Float32 in processSegment,
    // re-encode the result as WAV, and POST garbage audio to OpenAI — at
    // which point Whisper returns either nothing or hallucinated text
    // and the caller has no clean way to fall back to the mock.
    const engine = new WhisperAPIEngine();
    engine.setApiKey('sk-test-key');
    await expect(
      engine.startSession({ sampleRate: 16000 })
    ).rejects.toThrow(/PCM|webm\/opus|not yet supported|暂不支持/i);
  });
});
