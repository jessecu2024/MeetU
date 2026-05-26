// ============================================================
// iFlytek (讯飞) IAT WebSocket Authentication
//
// Implements the HMAC-SHA256 signing scheme documented at
// https://www.xfyun.cn/doc/asr/voicedictation/API.html#%E9%89%B4%E6%9D%83%E8%AE%A4%E8%AF%81
//
// Auth flow (used once per WebSocket connection):
//   1. Build a canonical "signing string" combining the host, an
//      RFC-1123 date stamp, and the HTTP request line.
//   2. HMAC-SHA256 the signing string using the user's APISecret.
//   3. Base64-encode the raw HMAC bytes → `signature`.
//   4. Assemble an "authorization origin" string of comma-separated
//      key="value" pairs (api_key, algorithm, headers, signature).
//   5. Base64-encode the authorization origin → `authorization`.
//   6. Open WebSocket at `wss://<host>/v2/iat?authorization=<...>&date=<...>&host=<...>`.
//
// Pure function, no engine state — exported so it can be unit-tested
// against the published reference vectors before we trust it on a
// live session.
// ============================================================

export interface XfyunAuthInputs {
  /** APIKey from console.xfyun.cn (NOT the AppID; not the AppSecret). */
  apiKey: string;
  /** APISecret from console.xfyun.cn. Used as the HMAC key. */
  apiSecret: string;
  /** Host name, e.g. "iat-api.xfyun.cn". */
  host: string;
  /** Path including leading slash, e.g. "/v2/iat". */
  path: string;
  /**
   * Optional RFC-1123 GMT date string. Defaults to "now". Exposed
   * so tests can pin the timestamp and verify a known-good signature.
   */
  date?: string;
}

/**
 * Build the fully-signed wss:// URL the renderer should open. Resolves
 * to a string in the shape:
 *
 *   wss://iat-api.xfyun.cn/v2/iat?authorization=<b64>&date=<rfc1123>&host=iat-api.xfyun.cn
 */
export async function buildXfyunAuthUrl(inputs: XfyunAuthInputs): Promise<string> {
  if (!inputs.apiKey) throw new Error('iFlytek apiKey is required');
  if (!inputs.apiSecret) throw new Error('iFlytek apiSecret is required');
  if (!inputs.host) throw new Error('iFlytek host is required');
  if (!inputs.path || !inputs.path.startsWith('/')) {
    throw new Error('iFlytek path must start with "/"');
  }

  const date = inputs.date ?? new Date().toUTCString();
  const signOrigin = `host: ${inputs.host}\ndate: ${date}\nGET ${inputs.path} HTTP/1.1`;
  const signature = await hmacSha256Base64(inputs.apiSecret, signOrigin);
  const authorizationOrigin =
    `api_key="${inputs.apiKey}", algorithm="hmac-sha256", ` +
    `headers="host date request-line", signature="${signature}"`;
  const authorization = base64Encode(authorizationOrigin);

  const params = new URLSearchParams({
    authorization,
    date,
    host: inputs.host,
  });
  return `wss://${inputs.host}${inputs.path}?${params.toString()}`;
}

/**
 * HMAC-SHA256 a UTF-8 message with a UTF-8 secret key, returning the
 * resulting raw 32-byte MAC encoded as standard Base64. Uses WebCrypto;
 * runs in both Electron's renderer (Chromium) and modern Node ≥19
 * which exposes the same `globalThis.crypto.subtle` interface.
 */
export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return arrayBufferToBase64(sig);
}

/**
 * Base64-encode a UTF-8 string. We use TextEncoder + Uint8Array rather
 * than `btoa` directly because `btoa` only accepts Latin-1 — an apiKey
 * accidentally containing a non-ASCII character would throw.
 */
export function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
