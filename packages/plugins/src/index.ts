/**
 * @sleiz/plugins - Plugin system contract.
 *
 * Plugins can extend Sleiz Studio without modifying core code:
 *   - AI providers (custom provider adapter)
 *   - Subtitle parsers / exporters (new formats)
 *   - Downloaders (new video sources)
 *   - Exporters (custom output formats)
 *
 * A plugin is a JS/TS module that default-exports an object implementing
 * `SleizPlugin`. At startup the host scans ./plugins/ (and any paths listed
 * in settings.pluginPaths), loads them, and registers their hooks.
 */

export type PluginType = 'ai-provider' | 'subtitle-parser' | 'subtitle-exporter' | 'downloader' | 'exporter';

export interface SleizPlugin {
  /** Unique plugin id. */
  id: string;
  /** Display name. */
  name: string;
  /** Plugin type — what extension point it provides. */
  type: PluginType;
  /** Semantic version. */
  version: string;
  /** Author. */
  author?: string;
  /** Optional description. */
  description?: string;
  /** Plugin-specific hook (typed per `type`). */
  setup?: (host: PluginHost) => void | Promise<void>;
}

export interface PluginHost {
  registerAIProvider: (id: string, factory: (config: { apiKey: string; model: string; baseUrl?: string }) => unknown) => void;
  registerSubtitleParser: (format: string, parser: (content: string) => unknown) => void;
  registerSubtitleExporter: (format: string, exporter: (cues: unknown[]) => string) => void;
  registerDownloader: (id: string, downloader: (url: string) => Promise<unknown>) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export const loadedPlugins: SleizPlugin[] = [];

export function registerPlugin(plugin: SleizPlugin): void {
  if (loadedPlugins.some((p) => p.id === plugin.id)) {
    console.warn(`[plugins] plugin "${plugin.id}" already loaded, skipping`);
    return;
  }
  loadedPlugins.push(plugin);
  console.log(`[plugins] loaded: ${plugin.name} v${plugin.version} (${plugin.type})`);
}
