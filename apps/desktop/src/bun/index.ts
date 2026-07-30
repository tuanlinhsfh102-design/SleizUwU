/**
 * Sleiz Studio - ElectroBun main process.
 *
 * Responsibilities:
 *   1. Start the embedded Hono API server (Bun.serve) on a local port.
 *   2. Create the main BrowserWindow and load the React web bundle.
 *   3. Wire RPC handlers for filesystem, shell, auto-update, and API passthrough.
 *   4. Auto-check for updates on startup (with a delay) and on a schedule.
 *
 * When run with `electrobun dev`, this file is bundled by ElectroBun's CLI.
 * When run with plain `bun` (for development without ElectroBun runtime), it
 * starts only the API server and exits with a friendly message.
 */

import { BrowserWindow, BrowserView, Updater, Utils, Tray } from 'electrobun/bun';
import { serve } from '@hono/node-server';
import { createDb } from '@sleiz/database';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { platform, arch, homedir } from 'node:os';
import { spawn } from 'node:child_process';
import type { SleizRPCSchema } from '../shared/rpc-types';

// #region debug-point helper:desktop-app-launch
const reportDebug = (hypothesisId: string, msg: string, data: Record<string, unknown> = {}) => {
  fetch(process.env.SLEIZ_DEBUG_URL || 'http://127.0.0.1:7778/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'desktop-app-launch',
      runId: process.env.SLEIZ_DEBUG_RUN_ID || 'pre-fix',
      hypothesisId,
      location: 'apps/desktop/src/bun/index.ts',
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

// #region debug-point D:process-errors
process.on('uncaughtExceptionMonitor', (error) => {
  reportDebug('D', 'uncaught exception monitor triggered', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
});
process.on('unhandledRejection', (reason) => {
  reportDebug('D', 'unhandled rejection detected', {
    reason: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : String(reason),
  });
});
// #endregion

// ---------------------------------------------------------------------------
// 1. Boot the embedded API + DB
// ---------------------------------------------------------------------------
/**
 * Resolve a stable per-user data directory for the DB + storage.
 *
 * This must NOT be relative to cwd: cwd is the app's `bin/` folder, which
 * `electrobun dev` rebuilds on every launch and which the installer replaces on
 * every update — a relative './data' there gets wiped, losing all user data.
 *
 * We compute the path ourselves instead of using `Utils.paths.userData`: that
 * helper reads `../Resources/version.json` relative to cwd and silently falls
 * back to empty identifier/channel strings, which in the packaged build yielded
 * a *relative* path (observed: data landed in `app/bin/data/`).
 */
function resolveUserDataDir(): string {
  const channel = process.env.ELECTROBUN_BUILD_ENV || 'stable';
  const appId = 'ai.sleiz.studio';
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');

  const dir = join(base, appId, channel);
  // Last-resort guard: never hand back a relative path.
  return isAbsolute(dir) ? dir : join(homedir(), `.${appId}`, channel);
}

const userDataDir = resolveUserDataDir();
process.env.DATABASE_URL ||= join(userDataDir, 'data', 'sleiz.db');
process.env.STORAGE_DIR ||= join(userDataDir, 'data', 'storage');
console.log(`[sleiz] user data dir: ${userDataDir}`);

// Built-in MongoDB target so a fresh install syncs without anyone typing a URI.
// `createDb()`'s ensureDefaultSettings() seeds this into settings.mongodbUri when
// that column is still empty, so a URI entered in the Settings UI always wins.
// Standard (non-SRV) form on purpose: Bun's DNS resolver cannot look up Atlas
// `mongodb+srv://` SRV records on this machine (querySrv ETIMEOUT).
process.env.MONGODB_URI ||=
  'mongodb://truongvusleiz_db_user:machi123@ac-xau6wpk-shard-00-00.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-01.0wfigjw.mongodb.net:27017,' +
  'ac-xau6wpk-shard-00-02.0wfigjw.mongodb.net:27017/' +
  '?ssl=true&replicaSet=atlas-11uz7a-shard-0&authSource=admin&appName=Cluster0';

// This must be imported only after DATABASE_URL is finalised above. Importing
// @sleiz/api eagerly creates its default app/database, which otherwise points
// at the transient executable working directory on Windows.
const { createApp, restoreDatabaseFromMongo, syncDatabaseToMongo } = await import('@sleiz/api');
// #region debug-point A:boot-config
reportDebug('A', 'desktop main boot starting', {
  cwd: process.cwd(),
  databaseUrl: process.env.DATABASE_URL,
  storageDir: process.env.STORAGE_DIR,
  apiPort: process.env.API_PORT || 8787,
  buildEnv: process.env.ELECTROBUN_BUILD_ENV || 'unknown',
});
// #endregion
const db = createDb();
const mongoStartup = await Promise.race([
  restoreDatabaseFromMongo(db),
  new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), 12_000)),
]);
if ('timeout' in mongoStartup) {
  // Do not let a stalled DNS/TLS connection prevent the desktop app from
  // starting. We intentionally avoid an initial empty snapshot in this case.
  console.warn('[sleiz] MongoDB restore timed out; app will continue offline');
} else {
  if (mongoStartup.ok && mongoStartup.restored) {
    console.log('[sleiz] restored local data from MongoDB');
  }
  // Upload pre-existing local data without delaying the UI. Future API writes
  // are synchronised by the global API middleware as well.
  void syncDatabaseToMongo(db).catch((error) => {
    console.warn('[sleiz] MongoDB initial sync skipped:', error instanceof Error ? error.message : error);
  });
}

const app = createApp();
const apiPort = Number(process.env.API_PORT || 8787);

async function isApiHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// #region debug-point B:api-serve-start
reportDebug('B', 'starting embedded API server', { apiPort });
// #endregion

// Reuse an already-running `bun dev:all` API instead of crashing on EADDRINUSE
if (await isApiHealthy(apiPort)) {
  console.log(`[sleiz] Reusing existing API on http://127.0.0.1:${apiPort}`);
  reportDebug('B', 'reusing existing API server', { apiPort });
} else {
  try {
    serve(
      { fetch: app.fetch, port: apiPort, hostname: '127.0.0.1' },
      (info) => {
        console.log(`[sleiz] API on http://${info.address}:${info.port}`);
        // #region debug-point B:api-serve-ready
        reportDebug('B', 'embedded API server listening', {
          address: info.address,
          port: info.port,
        });
        // #endregion
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('EADDRINUSE') || msg.includes('in use')) {
      console.error(
        `[sleiz] Port ${apiPort} is busy and /api/health is not reachable.\n` +
          `  Stop the other process (Ctrl+C leftover bun/dev:all) then retry.\n` +
          `  Or set API_PORT to a free port.`,
      );
      process.exit(1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. RPC handlers
// ---------------------------------------------------------------------------
const rpc = BrowserView.defineRPC<SleizRPCSchema>({
  maxRequestTime: 60_000,

  handlers: {
    requests: {
      // ---- API passthrough (so the webview never needs CORS) ----
      'api:fetch': async ({ path, method = 'GET', body }) => {
        const url = new URL(`http://127.0.0.1:${apiPort}${path}`);
        const req = new Request(url, {
          method,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          headers: { 'Content-Type': 'application/json' },
        });
        try {
          const res = await app.fetch(req);
          return {
            status: res.status,
            body: await res.text(),
            headers: Object.fromEntries(res.headers.entries()),
          };
        } catch (err) {
          console.error('[rpc api:fetch] internal error:', err);
          const msg = err instanceof Error ? err.message : String(err);
          const errBody = JSON.stringify({
            error: err instanceof Error ? (err.name || 'InternalError') : 'InternalError',
            message: msg || 'Lỗi không xác định khi xử lý request',
          });
          return {
            status: 500,
            body: errBody,
            headers: { 'Content-Type': 'application/json' },
          };
        }
      },

      // ---- Filesystem ----
      'fs:read': async ({ path, encoding = 'utf-8' }) => {
        try {
          const data = await readFile(path, encoding === 'binary' ? undefined : encoding);
          return { ok: true, data: encoding === 'binary' ? (data as Buffer).toString('base64') : data };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      'fs:write': async ({ path, content }) => {
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      'fs:stat': async ({ path }) => {
        try {
          const s = await stat(path);
          return { exists: true, size: s.size, isFile: s.isFile(), isDir: s.isDirectory() };
        } catch {
          return { exists: false };
        }
      },
      'fs:mkdir': async ({ path, recursive = true }) => {
        try {
          await mkdir(path, { recursive });
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      'fs:pickOpen': async () => {
        // ElectroBun doesn't ship native file pickers yet; we use a minimal
        // platform-specific helper via shell. For now return empty list.
        return { paths: [] };
      },
      'fs:pickSave': async () => ({ path: null }),
      'fs:pickDir': async () => ({ path: null }),

      // ---- Shell ----
      'shell:openExternal': async ({ url }) => {
        try {
          spawn(
            process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open',
            process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url],
            { detached: true, stdio: 'ignore' },
          ).unref();
          return { ok: true };
        } catch (err) {
          console.error('[shell:openExternal]', err);
          return { ok: false };
        }
      },
      'shell:openPath': async ({ path }) => {
        try {
          if (!existsSync(path)) return { ok: false, error: 'Path does not exist' };
          spawn(
            process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open',
            [path],
            { detached: true, stdio: 'ignore' },
          ).unref();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      'shell:showItemInFolder': async ({ path }) => {
        try {
          if (process.platform === 'darwin') {
            spawn('open', ['-R', path], { detached: true, stdio: 'ignore' }).unref();
          } else if (process.platform === 'win32') {
            spawn('explorer', ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
          } else {
            spawn('xdg-open', [dirname(path)], { detached: true, stdio: 'ignore' }).unref();
          }
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },

      // ---- App info ----
      'app:getVersion': async () => {
        const cfg = await import('electrobun/bun').then((m) => m.BuildConfig.get());
        return {
          version: cfg.runtime?.version || '0.0.0',
          channel: (process.env.ELECTROBUN_BUILD_ENV || 'dev') as string,
          platform: platform(),
          arch: arch(),
        };
      },
      'app:relaunch': async () => {
        // ElectroBun will relaunch on applyUpdate; for manual relaunch we re-exec.
        setTimeout(() => process.exit(0), 100);
        return { ok: true };
      },
      'app:quit': async () => {
        setTimeout(() => process.exit(0), 100);
        return { ok: true };
      },

      // ---- Native OS notification ----
      'notify:show': async ({ title, body, silent }) => {
        try {
          Utils.showNotification({ title, body, silent });
          return { ok: true };
        } catch (err) {
          console.warn('[notify:show] failed:', err);
          return { ok: false };
        }
      },

      // ---- Auto-update ----
      'update:getLocalInfo': async () => {
        return await Updater.getLocalInfo();
      },
      'update:check': async () => {
        return await Updater.checkForUpdate();
      },
      'update:download': async () => {
        try {
          await Updater.downloadUpdate();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      'update:apply': async () => {
        try {
          await Updater.applyUpdate();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },

    messages: {
      '*': (name, payload) => {
        console.log('[rpc] unhandled message from webview:', name, payload);
      },
    },
  },
});

// ---------------------------------------------------------------------------
// 3. Create the main window (Vite HMR in dev when server is up)
// ---------------------------------------------------------------------------
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  try {
    const channel = await Updater.localInfo.channel();
    if (channel === 'dev') {
      try {
        const res = await fetch(DEV_SERVER_URL, {
          method: 'GET',
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok || res.status > 0) {
          console.log(`[sleiz] HMR enabled via Vite at ${DEV_SERVER_URL}`);
          return DEV_SERVER_URL;
        }
      } catch {
        console.log(`[sleiz] Vite HMR not running; loading packaged views://web`);
      }
    }
  } catch {
    // Updater.localInfo may be unavailable outside electrobun runtime
  }
  return 'views://web/index.html';
}

const mainViewUrl = await getMainViewUrl();
// #region debug-point C:window-create-start
reportDebug('C', 'creating BrowserWindow', {
  url: mainViewUrl,
  width: 1440,
  height: 900,
});
// #endregion
const win = new BrowserWindow({
  title: 'Sleiz Studio',
  url: mainViewUrl,
  frame: { width: 1440, height: 900 },
  rpc,
});
// #region debug-point C:window-create-ready
reportDebug('C', 'BrowserWindow created', {
  hasWebview: Boolean(win.webview),
  url: mainViewUrl,
});
// #endregion

// ---------------------------------------------------------------------------
// 3b. System tray — quick show/focus + quit without needing the main window.
// Note: ElectroBun has no cancelable "before close" event yet, so clicking the
// window's native X button still fully quits the app (exitOnLastWindowClosed);
// this tray only adds a quick-access icon, it does not intercept the close button.
// ---------------------------------------------------------------------------
try {
  const tray = new Tray({ title: 'Sleiz Studio', image: 'views://assets/icon.png', template: false });
  tray.setMenu([
    { type: 'normal', label: 'Hiện Sleiz Studio', action: 'show' },
    { type: 'divider' },
    { type: 'normal', label: 'Thoát', action: 'quit' },
  ]);
  tray.on('tray-clicked', (event) => {
    const { action } = (event as { data: { action: string } }).data;
    if (action === 'quit') {
      process.exit(0);
    } else {
      // Default click (no action) or explicit "show" — bring window to front.
      win.show();
      win.focus();
    }
  });
} catch (err) {
  console.warn('[tray] setup failed (not supported on this platform?):', err);
}

// ---------------------------------------------------------------------------
// 4. Auto-update scheduler
// ---------------------------------------------------------------------------
async function autoUpdateLoop() {
  // Wait 30s after boot before first check (let user see the app first)
  await new Promise((r) => setTimeout(r, 30_000));
  try {
    const info = await Updater.checkForUpdate();
    console.log('[updater] check:', info);
    if (info.updateAvailable && !info.updateReady) {
      // Silently download in background
      await Updater.downloadUpdate().catch((err) => console.warn('[updater] download failed:', err));
      const status = Updater.updateInfo();
      if (status.updateReady) {
        // Notify the webview so it can show a "Restart to update" toast
        win.webview.rpc.send['update:ready']({ version: status.version });
      }
    }
  } catch (err) {
    console.warn('[updater] check failed:', err);
  }
  // Re-check every 6 hours
  setInterval(autoUpdateLoop, 6 * 60 * 60 * 1000);
}

// Only run auto-update loop in canary/stable builds; skip in dev.
if (process.env.ELECTROBUN_BUILD_ENV !== 'dev' && process.env.SLEIZ_DISABLE_UPDATE !== '1') {
  autoUpdateLoop();
}

// ---------------------------------------------------------------------------
// 5. Graceful shutdown
// ---------------------------------------------------------------------------
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
