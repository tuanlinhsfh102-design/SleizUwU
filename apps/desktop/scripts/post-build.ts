/**
 * Post-build hook for ElectroBun.
 *
 * Runs AFTER the inner app bundle is created, before ASAR / code signing.
 *
 * Use this to:
 *   - Inject extra resources (dictionaries, licenses, sample data)
 *   - Patch files inside the build dir
 *   - Generate a manifest of what's bundled
 *
 * Env vars passed by ElectroBun (in addition to pre-build):
 *   ELECTROBUN_BUILD_DIR  = path to the inner app bundle (e.g. .../build/Sleiz Studio.app/Contents/Resources/app)
 */

import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const env = process.env.ELECTROBUN_BUILD_ENV || 'dev';
const version = process.env.ELECTROBUN_APP_VERSION || '0.0.0';

console.log('[post-build] starting...');
console.log(`[post-build] build dir: ${buildDir || '(not set)'}`);

if (!buildDir) {
  console.warn('[post-build] ELECTROBUN_BUILD_DIR not set; skipping.');
  process.exit(0);
}

// Write a build-manifest.json inside the app bundle so the webview can show
// "Build env: stable, v0.2.0, built at 2026-07-25T..." in About.
const manifest = {
  app: 'Sleiz Studio',
  version,
  env,
  builtAt: new Date().toISOString(),
  platform: process.env.ELECTROBUN_OS,
  arch: process.env.ELECTROBUN_ARCH,
};

const manifestPath = join(buildDir, 'build-manifest.json');
try {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[post-build] wrote ${manifestPath}`);
} catch (err) {
  console.warn('[post-build] could not write manifest:', err);
}

// Optionally seed a fresh SQLite DB inside the bundle (only if not exists).
// This way the app works on first launch with sample data.
const dataDir = join(buildDir, 'data');
try {
  mkdirSync(dataDir, { recursive: true });
  console.log(`[post-build] ensured data dir: ${dataDir}`);
} catch (err) {
  console.warn('[post-build] mkdir data failed:', err);
}

// List the build dir for sanity
console.log('[post-build] bundle contents:');
try {
  for (const entry of readdirSync(buildDir)) {
    console.log(`  ${entry}`);
  }
} catch (err) {
  console.warn('[post-build] could not list build dir:', err);
}

console.log('[post-build] done.');
