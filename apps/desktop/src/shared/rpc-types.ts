/**
 * Shared RPC schema between Bun (main process) and Webview (browser context).
 *
 * Browser → Bun requests: anything the webview needs but cannot do itself
 *   (filesystem, shell, native dialogs, OS info, etc.)
 *
 * Bun → Browser requests: rarely used, but available (e.g. ask webview to
 *   navigate, show toast, focus element).
 *
 * Messages (fire-and-forget) are used for one-way notifications like
 * "download started", "update ready", etc.
 *
 * Reference: https://framework.blackboard.sh/electrobun/apis/browser-view/
 */

import type { RPCSchema } from 'electrobun/bun';

export interface UpdateInfo {
  version: string;
  hash: string;
  channel: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error?: string;
}

export interface DownloadProgressMsg {
  id: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface ToastMsg {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

export type SleizRPCSchema = {
  /** Handlers that run in Bun (main process), called from the webview. */
  bun: RPCSchema<{
    requests: {
      // ---- API passthrough (so webview never needs CORS or network config) ----
      'api:fetch': {
        params: { path: string; method?: string; body?: unknown };
        response: { status: number; body: string; headers: Record<string, string> };
      };

      // ---- Filesystem (webview has no fs access; everything goes through Bun) ----
      'fs:read': {
        params: { path: string; encoding?: 'utf-8' | 'binary' };
        response: { ok: boolean; data?: string; error?: string };
      };
      'fs:write': {
        params: { path: string; content: string };
        response: { ok: boolean; error?: string };
      };
      'fs:stat': {
        params: { path: string };
        response: { exists: boolean; size?: number; isFile?: boolean; isDir?: boolean };
      };
      'fs:mkdir': {
        params: { path: string; recursive?: boolean };
        response: { ok: boolean; error?: string };
      };
      'fs:pickOpen': {
        params: { filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean };
        response: { paths: string[] };
      };
      'fs:pickSave': {
        params: { defaultName?: string; filters?: Array<{ name: string; extensions: string[] }> };
        response: { path: string | null };
      };
      'fs:pickDir': {
        params: { defaultPath?: string };
        response: { path: string | null };
      };

      // ---- Shell ----
      'shell:openExternal': {
        params: { url: string };
        response: { ok: boolean };
      };
      'shell:openPath': {
        params: { path: string };
        response: { ok: boolean; error?: string };
      };
      'shell:showItemInFolder': {
        params: { path: string };
        response: { ok: boolean };
      };

      // ---- App info ----
      'app:getVersion': {
        params: Record<string, never>;
        response: { version: string; channel: string; platform: string; arch: string };
      };
      'app:relaunch': {
        params: Record<string, never>;
        response: { ok: boolean };
      };
      'app:quit': {
        params: Record<string, never>;
        response: { ok: boolean };
      };

      // ---- Auto-update (proxied to ElectroBun Updater) ----
      'update:getLocalInfo': {
        params: Record<string, never>;
        response: {
          version: string;
          hash: string;
          baseUrl: string;
          channel: string;
          name: string;
          identifier: string;
        };
      };
      'update:check': {
        params: Record<string, never>;
        response: UpdateInfo;
      };
      'update:download': {
        params: Record<string, never>;
        response: { ok: boolean; error?: string };
      };
      'update:apply': {
        params: Record<string, never>;
        response: { ok: boolean; error?: string };
      };

      // ---- Native OS notification (survives app being minimized/unfocused) ----
      'notify:show': {
        params: { title: string; body?: string; silent?: boolean };
        response: { ok: boolean };
      };
    };
    messages: {
      // none from webview to bun yet
    };
  }>;

  /** Handlers that run in the webview (browser), called from Bun. */
  webview: RPCSchema<{
    requests: {
      // none — webview doesn't expose request handlers to bun yet
    };
    messages: {
      'toast:show': ToastMsg;
      'update:progress': { percent: number; status: string };
      'update:ready': { version: string };
      'download:progress': DownloadProgressMsg;
    };
  }>;
};

export type { RPCSchema };
