// ============================================================
// AI Fetch — routes HTTP requests through Electron main process
// to bypass CORS restrictions in the renderer process.
// Falls back to regular fetch in non-Electron environments.
// ============================================================

interface AIFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  error?: string;
}

/**
 * Mimics the browser Fetch API but routes through Electron IPC.
 * Returns an object with .ok, .status, .json(), .text() like Response.
 */
export async function aiFetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>;
  text: () => Promise<string>;
  body: ReadableStream<Uint8Array> | null;
}> {
  const electronAPI = (window as unknown as { electronAPI?: { ai?: { fetch?: (url: string, init: unknown) => Promise<AIFetchResponse> } } }).electronAPI;

  if (electronAPI?.ai?.fetch) {
    // Route through main process (no CORS)
    const res = await electronAPI.ai.fetch(url, init || {});

    if (res.error && res.status === 0) {
      // Network-level error — throw like fetch does
      throw new Error(res.error);
    }

    const bodyText = res.body;
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      json: async () => JSON.parse(bodyText),
      text: async () => bodyText,
      // No streaming support through IPC — set to null
      body: null,
    };
  }

  // Fallback: direct fetch (for dev/testing outside Electron)
  return fetch(url, init);
}
