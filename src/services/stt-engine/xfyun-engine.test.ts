import { describe, it, expect } from 'vitest';
import { XfyunEngine } from './xfyun-engine';

describe('XfyunEngine.testConnection', () => {
  it('reports "no key" when nothing has been configured', async () => {
    const engine = new XfyunEngine();
    const r = await engine.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error || '').toMatch(/No API Key|appId:apiKey:apiSecret/);
  });

  it('reports "invalid format" when the credential is not appId:apiKey:apiSecret', async () => {
    const engine = new XfyunEngine();
    engine.setApiKey('just-a-bare-key');
    const r = await engine.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error || '').toMatch(/Invalid key format|appId:apiKey:apiSecret/);
  });

  it('does NOT claim success when format is valid — the WebSocket auth signer is still a placeholder', async () => {
    // Regression guard: previously this returned ok=true after a format-only
    // check, which told users "connection works" while startSession would
    // then be rejected by the server because generateAuthUrl emits
    // `signature="placeholder"`. The honest answer is failure with a clear
    // explanation until the HMAC-SHA256 signing is implemented.
    const engine = new XfyunEngine();
    engine.setApiKey('test_app_id:test_api_key:test_api_secret');
    const r = await engine.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error || '').toMatch(/HMAC|signing|签名|Beta/i);
  });
});
