/**
 * Type declaration for the `window.sleiz` API exposed by the ElectroBun
 * preload script (apps/desktop/src/webview/preload.ts).
 *
 * When running in a browser (web-only dev mode), `window.sleiz` is undefined
 * and the React app falls back to standard fetch() calls.
 */

export interface SleizToastMsg {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

export interface SleizDownloadProgressMsg {
  id: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface SleizNativeAPI {
  api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  fs: {
    read(path: string, encoding?: 'utf-8' | 'binary'): Promise<{ ok: boolean; data?: string; error?: string }>;
    write(path: string, content: string): Promise<{ ok: boolean; error?: string }>;
    stat(path: string): Promise<{ exists: boolean; size?: number; isFile?: boolean; isDir?: boolean }>;
    mkdir(path: string, recursive?: boolean): Promise<{ ok: boolean; error?: string }>;
  };
  shell: {
    openExternal(url: string): Promise<{ ok: boolean }>;
    openPath(path: string): Promise<{ ok: boolean; error?: string }>;
    showInFolder(path: string): Promise<{ ok: boolean }>;
  };
  app: {
    getVersion(): Promise<{ version: string; channel: string; platform: string; arch: string }>;
    relaunch(): Promise<{ ok: boolean }>;
    quit(): Promise<{ ok: boolean }>;
  };
  update: {
    getLocalInfo(): Promise<{
      version: string;
      hash: string;
      baseUrl: string;
      channel: string;
      name: string;
      identifier: string;
    }>;
    check(): Promise<{
      version: string;
      hash: string;
      updateAvailable: boolean;
      updateReady: boolean;
      error?: string;
    }>;
    download(): Promise<{ ok: boolean; error?: string }>;
    apply(): Promise<{ ok: boolean; error?: string }>;
  };
  onToast(fn: (msg: SleizToastMsg) => void): () => void;
  onUpdate(
    fn: (msg: {
      type: 'progress' | 'ready';
      percent?: number;
      status?: string;
      version?: string;
    }) => void,
  ): () => void;
  onDownload(fn: (msg: SleizDownloadProgressMsg) => void): () => void;
}

declare global {
  interface Window {
    sleiz?: SleizNativeAPI;
    __sleizToastListeners?: Array<(msg: SleizToastMsg) => void>;
    __sleizUpdateListeners?: Array<{
      (msg: { type: 'progress' | 'ready'; percent?: number; status?: string; version?: string }): void;
    }>;
    __sleizDownloadListeners?: Array<(msg: SleizDownloadProgressMsg) => void>;
  }
}

export {};
