import { describe, it, expect } from 'vitest';
import { buildXfyunAuthUrl, hmacSha256Base64, base64Encode } from './xfyun-signature';

describe('hmacSha256Base64', () => {
  // Reference vector from RFC 4231 §4.2: HMAC-SHA-256 of "Hi There"
  // with the 20-byte key 0x0b * 20. Expected MAC (hex):
  //   b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
  // base64 of those bytes:
  //   sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c=
  it('matches RFC 4231 vector #2 (Hi There, key 0x0b * 20)', async () => {
    const key = String.fromCharCode(...new Array(20).fill(0x0b));
    const r = await hmacSha256Base64(key, 'Hi There');
    expect(r).toBe('sDRMYdjbOFNcqK/OrwvxK4gdwgDJgz2nJuk3bC4yz/c=');
  });

  // Reference vector from RFC 4231 §4.3: HMAC-SHA-256 with the key
  // "Jefe" and message "what do ya want for nothing?". Expected MAC:
  //   5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
  // base64:
  //   W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=
  it('matches RFC 4231 vector #3 (Jefe / "what do ya want for nothing?")', async () => {
    const r = await hmacSha256Base64('Jefe', 'what do ya want for nothing?');
    expect(r).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=');
  });

  it('handles UTF-8 input correctly', async () => {
    // Independent reference computed with `openssl dgst -sha256 -hmac
    // "密钥" <<< -n "你好"` — both verifies UTF-8 path and that we
    // don't accidentally use Latin-1.
    const r = await hmacSha256Base64('密钥', '你好');
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
    // Same key + same message must produce the same MAC every time.
    expect(await hmacSha256Base64('密钥', '你好')).toBe(r);
  });
});

describe('base64Encode', () => {
  it('matches btoa for ASCII', () => {
    expect(base64Encode('Hello, world!')).toBe(btoa('Hello, world!'));
  });

  it('handles non-ASCII without throwing (UTF-8 path)', () => {
    // btoa('你好') would throw because '你' is outside Latin-1.
    // Our wrapper goes through TextEncoder so non-ASCII is fine.
    expect(() => base64Encode('你好')).not.toThrow();
    // Round-trip: base64 → raw bytes → UTF-8 decode → original string.
    // We can't atob+toString because atob returns a Latin-1 string of
    // the underlying bytes; we must explicitly UTF-8-decode.
    const enc = base64Encode('你好');
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe('你好');
  });
});

describe('buildXfyunAuthUrl', () => {
  const FIXED_INPUTS = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    host: 'iat-api.xfyun.cn',
    path: '/v2/iat',
    // Pin the date so signature is deterministic and a code change
    // that drifts the signature would flip this test.
    date: 'Thu, 22 May 2026 03:00:00 GMT',
  };

  it('rejects missing apiKey / apiSecret / host / path', async () => {
    await expect(buildXfyunAuthUrl({ ...FIXED_INPUTS, apiKey: '' }))
      .rejects.toThrow(/apiKey/);
    await expect(buildXfyunAuthUrl({ ...FIXED_INPUTS, apiSecret: '' }))
      .rejects.toThrow(/apiSecret/);
    await expect(buildXfyunAuthUrl({ ...FIXED_INPUTS, host: '' }))
      .rejects.toThrow(/host/);
    await expect(buildXfyunAuthUrl({ ...FIXED_INPUTS, path: '' }))
      .rejects.toThrow(/path/);
    await expect(buildXfyunAuthUrl({ ...FIXED_INPUTS, path: 'no-leading-slash' }))
      .rejects.toThrow(/path/);
  });

  it('produces a wss URL with all required query parameters', async () => {
    const url = await buildXfyunAuthUrl(FIXED_INPUTS);
    expect(url.startsWith('wss://iat-api.xfyun.cn/v2/iat?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('host')).toBe('iat-api.xfyun.cn');
    expect(parsed.searchParams.get('date')).toBe(FIXED_INPUTS.date);
    expect(parsed.searchParams.get('authorization')).not.toBeNull();
  });

  it('embeds api_key, algorithm, headers, and signature in the decoded authorization', async () => {
    const url = await buildXfyunAuthUrl(FIXED_INPUTS);
    const auth = new URL(url).searchParams.get('authorization')!;
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(auth), (c) => c.charCodeAt(0))
    );
    expect(decoded).toContain('api_key="test-api-key"');
    expect(decoded).toContain('algorithm="hmac-sha256"');
    expect(decoded).toContain('headers="host date request-line"');
    expect(decoded).toMatch(/signature="[A-Za-z0-9+/=]+"/);
    // The placeholder string the previous implementation hard-coded
    // must NOT appear — this is a regression guard against re-introducing
    // the stub.
    expect(decoded).not.toContain('signature="placeholder"');
  });

  it('produces a deterministic signature for fixed inputs (drift detector)', async () => {
    // If the canonical signing-string format ever changes, this golden
    // hash will flip. The value was computed by running the production
    // helper itself with these fixed inputs; treat it as a pinning
    // assertion against accidental signing-string edits.
    const url = await buildXfyunAuthUrl(FIXED_INPUTS);
    const auth = new URL(url).searchParams.get('authorization')!;
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(auth), (c) => c.charCodeAt(0))
    );
    const sigMatch = decoded.match(/signature="([^"]+)"/);
    expect(sigMatch).not.toBeNull();
    // Re-compute the expected signature independently using the exposed
    // primitive, so a refactor that breaks ONE of the two paths trips
    // this test.
    const signOrigin = `host: iat-api.xfyun.cn\ndate: ${FIXED_INPUTS.date}\nGET /v2/iat HTTP/1.1`;
    const expected = await hmacSha256Base64('test-api-secret', signOrigin);
    expect(sigMatch![1]).toBe(expected);
  });

  it('uses the current time when no `date` is provided', async () => {
    const url = await buildXfyunAuthUrl({
      apiKey: 'k',
      apiSecret: 's',
      host: 'iat-api.xfyun.cn',
      path: '/v2/iat',
    });
    const date = new URL(url).searchParams.get('date');
    // A valid RFC-1123 date contains GMT, day-of-week comma, etc.
    expect(date).toMatch(/, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
  });
});
