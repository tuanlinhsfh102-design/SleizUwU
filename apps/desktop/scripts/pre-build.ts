/**
 * Pre-build hook for ElectroBun.
 *
 * Runs BEFORE ElectroBun bundles the bun + webview code.
 *
 * Responsibilities:
 *   1. Build the React web bundle (Vite) so `../../web/dist/` is fresh.
 *   2. Verify the dist exists (build.copy in electrobun.config.ts points to it).
 *   3. Print environment info.
 *
 * Env vars passed by ElectroBun:
 *   ELECTROBUN_BUILD_ENV  = dev | canary | stable
 *   ELECTROBUN_OS         = macos | win | linux
 *   ELECTROBUN_ARCH       = x64 | arm64
 *   ELECTROBUN_BUILD_DIR  = path to build/
 *   ELECTROBUN_APP_NAME, ELECTROBUN_APP_VERSION, ELECTROBUN_APP_IDENTIFIER
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const webDistPath = resolve(import.meta.dir, '../../web/dist');
const env = process.env.ELECTROBUN_BUILD_ENV || 'dev';
const os = process.env.ELECTROBUN_OS || process.platform;
const arch = process.env.ELECTROBUN_ARCH || process.arch;

console.log('┌──────────────────────────────────────────────');
console.log('│  Sleiz Studio - pre-build');
console.log('├──────────────────────────────────────────────');
console.log(`│  env:      ${env}`);
console.log(`│  platform: ${os} / ${arch}`);
console.log(`│  web dist: ${webDistPath}`);
console.log('└──────────────────────────────────────────────');

// Step 1: Build the React web bundle (skip if already built and SLEIZ_SKIP_WEB=1)
if (process.env.SLEIZ_SKIP_WEB !== '1') {
  console.log('[pre-build] Building web bundle with Vite...');
  const webDir = resolve(import.meta.dir, '../../web');
  await new Promise<void>((resolveP, rejectP) => {
    const isWindows = process.platform === 'win32';
    const proc = spawn('bun', ['x', 'vite', 'build'], {
      cwd: webDir,
      stdio: 'inherit',
      shell: isWindows,
    });
    proc.on('error', rejectP);
    proc.on('close', (code) => (code === 0 ? resolveP() : rejectP(new Error(`vite build exited ${code}`))));
  });
}

// Step 2: Verify
if (!existsSync(webDistPath)) {
  throw new Error(`[pre-build] web dist not found at ${webDistPath}. Run "bun --filter ./apps/web build" first.`);
}
if (!existsSync(`${webDistPath}/index.html`)) {
  throw new Error(`[pre-build] ${webDistPath}/index.html missing. Did Vite build succeed?`);
}

// Step 3: Print artifact info
const { readdirSync, statSync } = await import('node:fs');
const totalSize = readdirSync(webDistPath).reduce((sum, f) => {
  try {
    return sum + statSync(`${webDistPath}/${f}`).size;
  } catch {
    return sum;
  }
}, 0);
console.log(`[pre-build] web dist: ${(totalSize / 1024).toFixed(1)} KB`);
console.log('[pre-build] done.');
