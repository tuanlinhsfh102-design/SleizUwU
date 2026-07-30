/**
 * Webview preload script - sets up the Electroview RPC bridge that the React
 * web bundle uses to talk to the Bun main process.
 *
 * This script is bundled by ElectroBun's CLI and loaded into the webview
 * before any page script runs. It exposes a global `window.sleiz` object
 * with typed methods the React app can call.
 */

import { Electroview } from 'electrobun/view';
import type { SleizRPCSchema, ToastMsg, DownloadProgressMsg, UpdateInfo } from '../shared/rpc-types';

const rpc = Electroview.defineRPC<SleizRPCSchema>({
  handlers: {
    requests: {},
    messages: {
      'toast:show': (msg: ToastMsg) => {
        // The React app subscribes via window.__sleizToastListeners
        window.__sleizToastListeners?.forEach((fn) => fn(msg));
      },
      'update:progress': (msg: { percent: number; status: string }) => {
        window.__sleizUpdateListeners?.forEach((fn) => fn({ type: 'progress', ...msg }));
      },
      'update:ready': (msg: { version: string }) => {
        window.__sleizUpdateListeners?.forEach((fn) => fn({ type: 'ready', ...msg }));
      },
      'download:progress': (msg: DownloadProgressMsg) => {
        window.__sleizDownloadListeners?.forEach((fn) => fn(msg));
      },
    },
  },
});

const electroview = new Electroview({ rpc });

// Expose a typed API to the React app
const sleiz = {
  // API passthrough — drop-in replacement for fetch('/api/...')
  async api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const r = await electroview.rpc.request['api:fetch']({
      path,
      method: init?.method || 'GET',
      body: init?.body,
    });
    if (r.status >= 400) {
      let msg = `HTTP ${r.status}`;
      try {
        const err = JSON.parse(r.body);
        msg = err.message || err.error || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    if (r.status === 204) return undefined as T;
    return JSON.parse(r.body) as T;
  },

  // Filesystem
  fs: {
    read: (path: string, encoding?: 'utf-8' | 'binary') =>
      electroview.rpc.request['fs:read']({ path, encoding }),
    write: (path: string, content: string) => electroview.rpc.request['fs:write']({ path, content }),
    stat: (path: string) => electroview.rpc.request['fs:stat']({ path }),
    mkdir: (path: string, recursive?: boolean) =>
      electroview.rpc.request['fs:mkdir']({ path, recursive }),
  },

  // Shell
  shell: {
    openExternal: (url: string) => electroview.rpc.request['shell:openExternal']({ url }),
    openPath: (path: string) => electroview.rpc.request['shell:openPath']({ path }),
    showInFolder: (path: string) => electroview.rpc.request['shell:showItemInFolder']({ path }),
  },

  // App info
  app: {
    getVersion: () => electroview.rpc.request['app:getVersion']({}),
    relaunch: () => electroview.rpc.request['app:relaunch']({}),
    quit: () => electroview.rpc.request['app:quit']({}),
  },

  // Auto-update
  update: {
    getLocalInfo: () => electroview.rpc.request['update:getLocalInfo']({}),
    check: () => electroview.rpc.request['update:check']({}) as Promise<UpdateInfo>,
    download: () => electroview.rpc.request['update:download']({}),
    apply: () => electroview.rpc.request['update:apply']({}),
  },

  // Listeners for messages pushed from Bun
  onToast: (fn: (msg: ToastMsg) => void) => {
    window.__sleizToastListeners ??= [];
    window.__sleizToastListeners.push(fn);
    return () => {
      window.__sleizToastListeners = window.__sleizToastListeners?.filter((f) => f !== fn);
    };
  },
  onUpdate: (fn: (msg: { type: 'progress' | 'ready'; percent?: number; status?: string; version?: string }) => void) => {
    window.__sleizUpdateListeners ??= [];
    window.__sleizUpdateListeners.push(fn);
    return () => {
      window.__sleizUpdateListeners = window.__sleizUpdateListeners?.filter((f) => f !== fn);
    };
  },
  onDownload: (fn: (msg: DownloadProgressMsg) => void) => {
    window.__sleizDownloadListeners ??= [];
    window.__sleizDownloadListeners.push(fn);
    return () => {
      window.__sleizDownloadListeners = window.__sleizDownloadListeners?.filter((f) => f !== fn);
    };
  },
};

// Type the global so the React app sees it
declare global {
  interface Window {
    sleiz: typeof sleiz;
    __sleizToastListeners?: Array<(msg: ToastMsg) => void>;
    __sleizUpdateListeners?: Array<(msg: { type: 'progress' | 'ready'; percent?: number; status?: string; version?: string }) => void>;
    __sleizDownloadListeners?: Array<(msg: DownloadProgressMsg) => void>;
  }
}

window.sleiz = sleiz;

console.log('[sleiz] preload ready, sleiz API exposed on window.sleiz');
