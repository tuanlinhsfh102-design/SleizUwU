/**
 * Tiny fetch wrapper used by all TanStack Query hooks.
 *
 * Routing strategy (in priority order):
 *   1. Inside the ElectroBun desktop webview, use `window.sleiz.api()` — the
 *      preload's RPC bridge — so requests are proxied through the Bun main
 *      process to the embedded Hono server. This avoids the
 *      `views://web/api/...` 404 that a relative `fetch('/api/...')` would
 *      produce when the page itself is served from a custom protocol.
 *   2. Otherwise (real browser / web), use `fetch` against the base URL
 *      from VITE_API_URL, defaulting to relative /api (proxied by Vite in dev).
 */
import type {} from '@tanstack/react-query';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface NativeApi {
  api: <T = unknown>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
}

function getNativeApi(): NativeApi['api'] | null {
  if (typeof window === 'undefined') return null;
  const sleiz = (window as unknown as { sleiz?: NativeApi }).sleiz;
  return sleiz?.api ?? null;
}

// The desktop webview can load the packaged bundle (views://, app://, or
// another custom protocol) before/without the ElectroBun preload bridge
// attaching `window.sleiz`. A relative fetch('/api/...') from a non-http
// origin can never reach anything, so fall back to the known embedded API
// port directly instead of failing outright.
function getFallbackBase(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  const protocol = window.location.protocol;
  if (protocol === 'http:' || protocol === 'https:') return '';
  return `http://127.0.0.1:${import.meta.env.VITE_API_PORT || 8787}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = !!(init?.body && init.body instanceof FormData);
  const method = (init?.method || 'GET').toUpperCase();
  const body =
    init?.body && !isFormData
      ? typeof init.body === 'string'
        ? safeJsonParse(init.body)
        : (init.body as unknown)
      : undefined;

  const nativeApi = getNativeApi();
  if (nativeApi && !isFormData) {
    try {
      return await nativeApi<T>(path, { method, body });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
        throw new Error('Không thể kết nối đến server API. Hãy đảm bảo ứng dụng đang chạy đúng cách.');
      }
      throw err;
    }
  }

  let base = API_BASE || getFallbackBase();

  const url = path.startsWith('http') ? path : `${base}${path}`;
  let res: Response;
  try {
    const headers = new Headers(init?.headers || {});
    if (!isFormData && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    res = await fetch(url, { ...init, headers });
  } catch (err) {
    const originalMsg = err instanceof Error ? err.message : String(err);
    if (originalMsg.includes('Failed to fetch') || originalMsg.includes('NetworkError') || /CORS|blocked|cors/i.test(originalMsg)) {
      const target = base || '(proxy /api)';
      throw new Error(
        `Không thể kết nối đến API (${target}).\n` +
        `- Nếu chạy web dev: hãy khởi chạy API server (bun dev:api ở port ${process.env.VITE_API_PORT || 8787})\n` +
        `- Nếu chạy desktop: hãy khởi động lại ứng dụng hoặc báo lỗi này.\n` +
        `Chi tiết: ${originalMsg}`,
      );
    }
    if (err instanceof Error) throw err;
    throw new Error(String(err));
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      message = err.message || err.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Native OS notification (survives the app being minimized/unfocused) — only
 * works inside the ElectroBun desktop webview (RPC bridge -> Utils.showNotification).
 * No-op in the plain web build; in-app toasts already cover that case.
 */
export function notifyNative(title: string, body?: string): void {
  const nativeApi = getNativeApi();
  if (!nativeApi) return;
  nativeApi('notify:show', { method: 'POST', body: { title, body } }).catch(() => {
    /* best-effort — a missed notification shouldn't break the caller's flow */
  });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
  uploadFile: async (file: File, onProgress?: (percent: number) => void): Promise<{ url: string; fileName: string; size: number }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.postForm<{ ok: boolean; data: { url: string; fileName: string; storedName: string; size: number; ext: string } }>(
      '/api/upload',
      fd,
    );
    void onProgress;
    if (!res || !res.ok || !res.data) throw new Error('Upload thất bại: response không hợp lệ');
    return { url: res.data.url, fileName: res.data.fileName, size: res.data.size };
  },
};
