// ============================================================
// AudioWorkletProcessor that PLAYS BACK externally-supplied PCM
// frames into the Web Audio graph. The inverse of pcm-worklet.ts.
//
// Used by the macOS native ScreenCaptureKit path: the native addon
// delivers 16-kHz mono Float32 PCM frames over IPC, but the rest of
// the capture pipeline (MediaRecorder for Deepgram/Whisper/file
// recording, the 48k->16k resampler for iFlytek) expects a normal
// MediaStream. We push the incoming PCM into this worklet's ring
// buffer; the worklet emits it sample-by-sample into a
// MediaStreamAudioDestinationNode, whose `.stream` is then fed to
// the existing pipeline unchanged.
//
// Ring buffer rationale: IPC frames arrive in bursts (ScreenCaptureKit
// hands us ~10-20 ms chunks on its own schedule), but the audio
// render quantum pulls a fixed 128 samples every ~8 ms (at 16 kHz).
// A ring buffer decouples the two rates. If the buffer underruns
// (no PCM yet) the worklet emits silence rather than glitching; if
// it overruns (renderer fell behind) the oldest samples are dropped.
//
// Loaded via addModule(blobUrl) — same stringified-source trick as
// pcm-worklet.ts so no bundler entry point is required.
// ============================================================

export const PCM_PLAYBACK_WORKLET_NAME = 'meetu-pcm-player';

/**
 * Worklet source. Self-contained (worklet thread has no DOM / imports
 * / closures over renderer globals). The renderer posts Float32Array
 * frames to `port`; the worklet writes them into a fixed ring buffer
 * and drains them into the output on each process() call.
 *
 * RING_CAPACITY is sized for ~2 s at 16 kHz (32k samples) — enough to
 * absorb IPC jitter without unbounded latency. On overrun we advance
 * the read pointer (drop oldest) so latency stays bounded.
 */
export const PCM_PLAYBACK_WORKLET_SOURCE = `
const RING_CAPACITY = 32768; // ~2s @ 16kHz, power of two
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_CAPACITY);
    this.readIdx = 0;
    this.writeIdx = 0;
    this.size = 0; // samples currently buffered
    this.port.onmessage = (event) => {
      const frame = event.data;
      if (!frame || frame.length === 0) return;
      for (let i = 0; i < frame.length; i++) {
        if (this.size >= RING_CAPACITY) {
          // Overrun: drop the oldest sample to make room. Keeps
          // latency bounded if the consumer (MediaRecorder) stalls.
          this.readIdx = (this.readIdx + 1) % RING_CAPACITY;
          this.size--;
        }
        this.ring[this.writeIdx] = frame[i];
        this.writeIdx = (this.writeIdx + 1) % RING_CAPACITY;
        this.size++;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channel = output[0];
    for (let i = 0; i < channel.length; i++) {
      if (this.size > 0) {
        channel[i] = this.ring[this.readIdx];
        this.readIdx = (this.readIdx + 1) % RING_CAPACITY;
        this.size--;
      } else {
        channel[i] = 0; // underrun -> silence, never a glitch
      }
    }
    return true;
  }
}
registerProcessor('${PCM_PLAYBACK_WORKLET_NAME}', PcmPlayer);
`;
