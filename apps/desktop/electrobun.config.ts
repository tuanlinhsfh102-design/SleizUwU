/**
 * ElectroBun build configuration for Sleiz Studio.
 *
 * Schema reference: https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/
 *
 * Notes:
 *  - File must be `electrobun.config.ts` (TypeScript ESM), NOT .json
 *  - Windows are created at runtime via `new BrowserWindow({...})` in src/bun/index.ts
 *  - Web bundle is built separately with Vite (`apps/web/dist/`) and copied
 *    into `views://web/` via build.copy so the BrowserView can load it
 *  - release.baseUrl is where you host the artifacts/ folder (S3/R2/GitHub Releases)
 */
import type { ElectrobunConfig } from 'electrobun';

const APP_VERSION = '0.3.0';

export default {
  app: {
    name: 'Sleiz Studio',
    identifier: 'ai.sleiz.studio',
    version: APP_VERSION,
    // Optional: deep-link scheme (macOS only)
    urlSchemes: ['sleiz'],
  },

  runtime: {
    exitOnLastWindowClosed: true,
    // Custom keys are copied to build.json and readable at runtime via BuildConfig.get()
    apiPort: 8787,
    autoUpdate: true,
    updateChannel: 'stable',
  },

  build: {
    // Main Bun process (creates window, hosts Hono API, handles RPC)
    bun: {
      entrypoint: 'src/bun/index.ts',
      target: 'bun',
      sourcemap: 'linked',
      minify: false, // easier debugging; flip to true for stable
    },

    // Webview preload script (sets up Electroview RPC bridge in browser context)
    views: {
      webview: {
        entrypoint: 'src/webview/preload.ts',
        target: 'browser',
        sourcemap: 'linked',
        minify: false,
      },
    },

    // Copy the pre-built Vite bundle into views://web/*
    // Paths are resolved relative to the electrobun.config.ts file location.
    copy: {
      '../web/dist/index.html': 'views/web/index.html',
      '../web/dist/assets': 'views/web/assets',
      '../web/dist/favicon.svg': 'views/web/favicon.svg',
      'assets/icon.png': 'views/assets/icon.png',
    },

    // Ignore Vite output in watch mode — HMR handles view rebuilds separately
    watchIgnore: ['../web/dist/**'],

    // Optional ASAR packaging (keeps bundle tidy on disk)
    useAsar: true,
    asarUnpack: ['*.node', '*.dll', '*.dylib', '*.so'],

    // Per-platform overrides
    mac: {
      codesign: process.env.ELECTROBUN_DEVELOPER_ID ? true : false,
      notarize: process.env.ELECTROBUN_APPLEID ? true : false,
      icons: 'assets/icon.iconset',
    },
    win: {
      icon: 'assets/icon.png', // .ico or .png ≥256x256
    },
    linux: {
      icon: 'assets/icon.png',
      // WebKitGTK has limitations; bundle CEF for the most consistent UI
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
  },

  // Auto-update: host the contents of `artifacts/` here.
  // For GitHub Releases (stable channel only):
  //   baseUrl: 'https://github.com/tuanlinhsfh102-design/SleizUwU/releases/latest/download'
  // For S3/R2 (works for both canary and stable):
  //   baseUrl: 'https://your-bucket.s3.amazonaws.com/sleiz-studio/'
  release: {
    baseUrl:
      process.env.SLEIZ_UPDATE_BASE_URL ||
      'https://github.com/tuanlinhsfh102-design/SleizUwU/releases/latest/download',
  },

  // Build lifecycle hooks (paths relative to this config file)
  scripts: {
    preBuild: './scripts/pre-build.ts',
    postBuild: './scripts/post-build.ts',
    // postWrap and postPackage are optional
  },
} satisfies ElectrobunConfig;
