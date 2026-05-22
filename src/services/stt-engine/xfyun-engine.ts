// ============================================================
// iFlytek (讯飞) IAT STT Engine — WebSocket real-time streaming (BYOK)
//
// Wire protocol: wss://iat-api.xfyun.cn/v2/iat
//   - Auth: HMAC-SHA256 signature in query string (see xfyun-signature.ts)
//   - Audio: 16-kHz mono PCM Int16 frames, base64-encoded, sent as
//            { data: { status: 0|1|2, format, encoding, audio } }
//   - First frame: status=0 (start) with optional common+business params
//   - Subsequent frames: status=1 (continue)
//   - Final frame: status=2 (end)
//   - Response: { code, message, data: { result: { ws: [{cw:[{w}]}] }, status } }
//
// Best Chinese speech recognition vendor; supports dialects.
// ============================================================

import type {
  STTEngine, STTEngineId, STTConfig, TranscriptResult, AudioDeliveryMode,
} from './types';
import { buildXfyunAuthUrl } from './xfyun-signature';

const XFYUN_HOST = 'iat-api.xfyun.cn';
const XFYUN_PATH = '/v2/iat';
const SAMPLE_RATE = 16000;

export class XfyunEngine implements STTEngine {
  readonly id: STTEngineId = 'xfyun';
  readonly name = 'iFlytek Speech';
  readonly region = 'china' as const;
  readonly supportsRealtime = true;

  // PCM stream because IAT only accepts audio/L16;rate=16000;
  // webm/opus is rejected.
  readonly audioMode: AudioDeliveryMode = 'pcm-stream';

  private appId = '';
  private apiKey = '';
  private apiSecret = '';
  private ws: WebSocket | null = null;
  private callback: ((result: TranscriptResult) => void) | null = null;
  private running = false;
  private firstFrame = true;
  private sentenceCounter = 0;
  private sessionStartTime = 0;
  // iFlytek streams partial results that grow inside a single sentence
  // (pgs='rpl' means "replace the previous partial", 'apd' means
  // "append to the previous partial") and then emits a final
  // (ls=true) at sentence end. To make the transcript store overwrite
  // the partial in place instead of accumulating duplicate rows,
  // every partial for the same sentence must carry the SAME id.
  // We mint a new id at the start of each sentence and reuse it for
  // every partial until ls=true closes the sentence.
  private currentSentenceId = '';
  // Text accumulated within the CURRENT sentence by 'apd' partials.
  // 'rpl' partials reset it; 'ls=true' (final) freezes the sentence
  // into a transcript row and clears this for the next sentence.
  private currentSentenceBuffer = '';

  /**
   * iFlytek requires credentials in `AppID:APIKey:APISecret` form.
   * The console shows the three pieces separately; users paste them
   * concatenated with `:` because we don't have three fields in the
   * settings UI for them.
   */
  setApiKey(key: string): void {
    const parts = (key || '').split(':');
    if (parts.length >= 3) {
      this.appId = parts[0].trim();
      this.apiKey = parts[1].trim();
      this.apiSecret = parts[2].trim();
    } else {
      // One-token form (legacy). It cannot pass authentication, but
      // we keep it set so the format-check error is meaningful.
      this.apiKey = key.trim();
      this.appId = '';
      this.apiSecret = '';
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!this.apiKey || !this.appId || !this.apiSecret) {
      return {
        ok: false,
        error:
          'Missing credentials. Use the AppID:APIKey:APISecret form from console.xfyun.cn. ' +
          '/ 缺少凭据。请使用 console.xfyun.cn 上的 AppID:APIKey:APISecret 三段拼接形式。',
      };
    }
    // We actually try to open a WebSocket: if the signature is wrong
    // or the credentials are invalid, iFlytek closes the connection
    // with a non-1000 code shortly after `open`. Anything that
    // resolves on open() and stays connected for ~1s is a valid auth.
    let url: string;
    try {
      url = await buildXfyunAuthUrl({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        host: XFYUN_HOST,
        path: XFYUN_PATH,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      let probe: WebSocket | null = null;
      try {
        probe = new WebSocket(url);
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : 'WebSocket construct failed' });
        return;
      }
      const TIMEOUT_MS = 8000;
      const cleanup = () => {
        try { probe?.close(); } catch { /* ignore */ }
        probe = null;
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: 'Timeout waiting for iFlytek auth response. Check network / VPN / 等待讯飞鉴权响应超时。' });
      }, TIMEOUT_MS);

      probe.onopen = () => {
        // The socket opened — but iFlytek may still close immediately
        // with an auth error. Give it ~1s to confirm.
        setTimeout(() => {
          if (probe && probe.readyState === WebSocket.OPEN) {
            clearTimeout(timer);
            cleanup();
            resolve({ ok: true });
          }
        }, 1000);
      };

      probe.onmessage = (event) => {
        // iFlytek closes the socket on auth failure before the open
        // ack; if we see a message with code !== 0 it's an early error.
        try {
          const data = JSON.parse(event.data);
          if (data.code && data.code !== 0) {
            clearTimeout(timer);
            cleanup();
            resolve({ ok: false, error: `iFlytek error code ${data.code}: ${data.message || 'unknown'}` });
          }
        } catch { /* skip malformed */ }
      };

      probe.onerror = () => {
        clearTimeout(timer);
        cleanup();
        resolve({ ok: false, error: 'iFlytek WebSocket error. Check VPN / API credentials / 讯飞 WebSocket 错误，请检查网络与凭据。' });
      };

      probe.onclose = (event) => {
        // 1000 (normal closure) or 1006 (abnormal close after auth ok)
        // can both happen if we close()d ourselves above; only treat
        // policy-violation codes as failures.
        if (event.code === 1008 || event.code === 1011) {
          clearTimeout(timer);
          cleanup();
          resolve({ ok: false, error: `iFlytek closed with code ${event.code}: ${event.reason || 'auth rejected'}` });
        }
      };
    });
  }

  async startSession(_config: STTConfig): Promise<void> {
    if (!this.apiKey || !this.appId || !this.apiSecret) {
      throw new Error('iFlytek credentials not configured (AppID:APIKey:APISecret)');
    }

    const url = await buildXfyunAuthUrl({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      host: XFYUN_HOST,
      path: XFYUN_PATH,
    });

    this.sessionStartTime = Date.now();
    this.sentenceCounter = 0;
    this.currentSentenceId = '';
    this.currentSentenceBuffer = '';
    this.firstFrame = true;

    // iFlytek's auth-reject is asynchronous: the server accepts the
    // WebSocket OPEN handshake first, then closes (or sends a 401-ish
    // JSON) within a few hundred milliseconds if the signature/host/
    // date are wrong. If we resolve on `open` and the engine reports
    // success, meeting-store wires audio in BEFORE the close arrives,
    // misses its chance to fall back to the mock engine, and the user
    // sees a permanently dead recording.
    //
    // To avoid that race, we wait `SETTLE_MS` after `open` before
    // resolving. Any close/error/code!=0 message during that window
    // turns into a reject; afterwards we hand off to the session's
    // own onmessage / onclose handlers.
    const SETTLE_MS = 800;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;     // either resolved or rejected
      let opened = false;      // ws.onopen has fired

      const openTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error('iFlytek WebSocket open timeout (8s)'));
      }, 8000);

      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      const finishOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        if (settleTimer) clearTimeout(settleTimer);
        this.running = true;
        console.log('[iFlytek] WebSocket connected (auth settled)');
        // After settling, the session's regular onmessage handles
        // results and onclose flips `running`. Both are re-attached
        // here as plain assignments.
        ws.onmessage = (event) => this.handleMessage(event.data);
        ws.onclose = () => { this.running = false; };
        resolve();
      };

      const finishFail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        if (settleTimer) clearTimeout(settleTimer);
        try { ws.close(); } catch { /* ignore */ }
        this.ws = null;
        reject(new Error(msg));
      };

      ws.onopen = () => {
        opened = true;
        // Don't resolve yet — give iFlytek a window to reject.
        settleTimer = setTimeout(finishOk, SETTLE_MS);
      };

      ws.onmessage = (event) => {
        // During the settle window, an error JSON (code !== 0) means
        // the session is dead — reject. After settling, the real
        // handler takes over via finishOk's reassignment.
        if (settled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.code && data.code !== 0) {
            finishFail(`iFlytek error code ${data.code}: ${data.message || 'unknown'}`);
          }
        } catch { /* skip malformed */ }
      };

      ws.onerror = () => {
        finishFail(opened
          ? 'iFlytek WebSocket error during auth settle'
          : 'iFlytek WebSocket error before open');
      };

      ws.onclose = (event) => {
        finishFail(`iFlytek WebSocket closed (code ${event.code}: ${event.reason || 'no reason given'})`);
      };
    });
  }

  /**
   * Receives 16-kHz mono Float32 PCM frames from capture (via the
   * AudioWorklet → resampler pipeline). Converts each frame to Int16
   * + base64 and posts an iFlytek `data` frame. The first frame must
   * carry `common` + `business` params; subsequent frames are
   * `status: 1` continuations; `stopSession` sends `status: 2`.
   */
  feedAudio(chunk: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.running) return;
    if (chunk.byteLength === 0) return;

    const audioBase64 = float32ToInt16Base64(new Float32Array(chunk));
    const frame: Record<string, unknown> = {
      data: {
        status: this.firstFrame ? 0 : 1,
        format: `audio/L16;rate=${SAMPLE_RATE}`,
        encoding: 'raw',
        audio: audioBase64,
      },
    };
    if (this.firstFrame) {
      // common: app identification
      frame.common = { app_id: this.appId };
      // business: recognition behavior. `dwa: 'wpgs'` enables
      // word-level streaming with overwrite semantics; that means
      // result.pgs === 'rpl' tells us to replace the previous
      // partial transcript with the new one (we use that in
      // handleMessage to keep the UI from showing repeated growing
      // partials).
      frame.business = {
        language: 'zh_cn',
        domain: 'iat',
        accent: 'mandarin',
        vad_eos: 5000,
        dwa: 'wpgs',
        ptt: 1,
      };
      this.firstFrame = false;
    }
    this.ws.send(JSON.stringify(frame));
  }

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== 'string') return; // iFlytek replies are JSON strings
    let data: {
      code?: number;
      message?: string;
      data?: {
        status?: number;
        result?: {
          ls?: boolean;
          pgs?: 'apd' | 'rpl';
          ws?: Array<{ cw: Array<{ w: string }> }>;
        };
      };
    };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.code && data.code !== 0) {
      console.error(`[iFlytek] Error code ${data.code}: ${data.message || 'unknown'}`);
      return;
    }

    const result = data.data?.result;
    if (!result || !result.ws) return;

    const text = result.ws
      .map((w) => w.cw.map((c) => c.w).join(''))
      .join('')
      .trim();
    if (!text) return;

    // iFlytek result framing (when dwa=wpgs is enabled in business):
    //   - `pgs: 'rpl'`  → text replaces the buffer for the current sentence
    //   - `pgs: 'apd'`  → text appends to the buffer for the current sentence
    //   - no pgs        → treat like 'rpl' (i.e. the buffer is just text)
    //   - `ls: true`    → this is the final result for the current sentence
    //                     and the next message starts a fresh sentence
    //
    // We keep one transcript row per sentence by reusing the same id
    // across every partial within a sentence and only minting a new id
    // when ls=true closes it. The buffer is per-sentence; final flips
    // the transcript to isFinal=true and clears for the next sentence.
    const isFinal = result.ls === true;
    if (result.pgs === 'apd') {
      this.currentSentenceBuffer += text;
    } else {
      this.currentSentenceBuffer = text;
    }

    if (!this.currentSentenceId) {
      this.currentSentenceId = `xf-${++this.sentenceCounter}`;
    }
    const id = this.currentSentenceId;
    const sentenceText = this.currentSentenceBuffer;
    if (isFinal) {
      this.currentSentenceId = '';
      this.currentSentenceBuffer = '';
    }

    const now = Date.now();
    this.callback?.({
      id,
      text: sentenceText,
      isFinal,
      language: 'zh',
      startMs: Math.max(0, now - this.sessionStartTime - 2000),
      endMs: now - this.sessionStartTime,
      confidence: 0.9, // iFlytek does not return per-frame confidence
    });
  }

  onTranscript(callback: (result: TranscriptResult) => void): void {
    this.callback = callback;
  }

  async stopSession(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // status=2 tells iFlytek "no more audio, please return the
      // final result and close". Without this they keep the socket
      // open for vad_eos ms before reporting timeout.
      try {
        this.ws.send(JSON.stringify({
          data: { status: 2, format: `audio/L16;rate=${SAMPLE_RATE}`, encoding: 'raw', audio: '' },
        }));
      } catch (err) {
        console.warn('[iFlytek] failed to send end-frame:', err);
      }
    }
    this.running = false;
    // Give iFlytek up to 1.5s to deliver the final result frame
    // before we close — they sometimes send it after the end-frame ack.
    const ws = this.ws;
    if (ws) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try { ws.close(); } catch { /* ignore */ }
          this.ws = null;
          resolve();
        }, 1500);
        ws.onclose = () => {
          clearTimeout(t);
          this.ws = null;
          resolve();
        };
      });
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Convert a 16-kHz mono Float32 PCM frame to base64-encoded Int16LE,
 * which is what iFlytek's `audio/L16;rate=16000` format expects.
 */
function float32ToInt16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  // Treat the underlying bytes of the Int16 buffer as a Uint8Array,
  // then base64 via String.fromCharCode + btoa. We can't use
  // TextDecoder here because the bytes are binary, not UTF-8.
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  // Process in chunks to avoid stack-overflow from very long
  // String.fromCharCode arguments.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}
