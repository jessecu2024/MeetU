// ============================================================
// AudioWorkletProcessor that emits raw PCM Float32 frames at the
// AudioContext's native sample rate. Used when an STT engine
// declares `audioMode: 'pcm-stream'` (currently iFlytek).
//
// The processor copies its input buffer into a renderer-owned
// arraybuffer and posts it back on the worklet's MessagePort. The
// capture layer is then responsible for resampling 48k → 16k and
// passing the result to `feedAudio`.
//
// This file is loaded into a Worklet via `audioContext.audioWorklet
// .addModule(pcmWorkletUrl)`. The URL is built in capture.ts by
// stringifying this code into a Blob (so we don't need a build-time
// bundler trick to ship a separate worklet entry point).
// ============================================================

export const PCM_WORKLET_NAME = 'meetu-pcm-emitter';

/**
 * The actual worklet source as a string. Stringified rather than
 * imported so that `addModule(blobUrl)` works without bundler help.
 * Keep this implementation self-contained — it runs in a worklet
 * thread that has no DOM, no imports, and no closures over the
 * renderer's globals.
 */
export const PCM_WORKLET_SOURCE = `
class PcmEmitter extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;
    // Copy into a fresh Float32Array — the underlying buffer is
    // re-used by the audio thread, so postMessage MUST transfer or
    // copy. We copy and let the GC reclaim the original.
    const out = new Float32Array(channel.length);
    out.set(channel);
    this.port.postMessage(out, [out.buffer]);
    return true;
  }
}
registerProcessor('${PCM_WORKLET_NAME}', PcmEmitter);
`;
