/**
 * Application-wide constants.
 */

export const APP_NAME = 'Sleiz Studio';
export const APP_VERSION = '0.3.0';
export const APP_DESCRIPTION = 'Nền tảng dịch hoạt hình Trung Quốc sang tiếng Việt';

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_BATCH_SIZE = 100;

export const STORAGE_KEYS = {
  theme: 'sleiz:theme',
  sidebarCollapsed: 'sleiz:sidebar-collapsed',
  activeChannel: 'sleiz:active-channel',
  recentProjects: 'sleiz:recent-projects',
  commandPaletteOpen: 'sleiz:cmdk-open',
} as const;

export const API_PATHS = {
  // channels
  channels: '/api/channels',
  channel: (id: string) => `/api/channels/${id}`,
  // movies
  movies: '/api/movies',
  movie: (id: string) => `/api/movies/${id}`,
  movieWorkspace: (id: string) => `/api/movies/${id}/workspace`,
  // episodes
  episodes: '/api/episodes',
  episode: (id: string) => `/api/episodes/${id}`,
  // subtitles
  subtitles: '/api/subtitles',
  subtitle: (id: string) => `/api/subtitles/${id}`,
  subtitleTranslate: (id: string) => `/api/subtitles/${id}/translate`,
  subtitleTranslateStart: (id: string) => `/api/subtitles/${id}/translate/start`,
  subtitleTranslationReset: (id: string) => `/api/subtitles/${id}/translation/reset`,
  subtitleTranslateStatus: (id: string) => `/api/subtitles/${id}/translate/status`,
  // batches
  batches: '/api/batches',
  batch: (id: string) => `/api/batches/${id}`,
  // glossary
  glossary: '/api/glossary',
  glossaryEntry: (id: string) => `/api/glossary/${id}`,
  // characters
  characters: '/api/characters',
  // translation memory
  translationMemory: '/api/translation-memory',
  // ai
  aiTranslate: '/api/ai/translate',
  aiSpeech: '/api/ai/speech',
  aiMovieTitle: '/api/ai/movie-title',
  aiProviders: '/api/ai/providers',
  aiDescription: '/api/ai/description',
  aiDescriptionByEpisode: (episodeId: string) => `/api/ai/description/${episodeId}`,
  aiThumbnail: '/api/ai/thumbnail',
  aiConsistency: '/api/ai/consistency',
  aiSubtitleRewrite: '/api/ai/subtitle-rewrite',
  // bilibili
  bilibiliParse: '/api/bilibili/parse',
  bilibiliDownload: '/api/bilibili/download',
  bilibiliDownloadVideo: '/api/bilibili/download-video',
  bilibiliSubtitles: '/api/bilibili/subtitles',
  // tiktok
  tiktokParse: '/api/tiktok/parse',
  tiktokDownload: '/api/tiktok/download',
  // download progress
  downloadStatus: (jobId: string) => `/api/downloads/${jobId}/status`,
  // export
  exportSubtitle: '/api/export/subtitle',
  // media translation and rendering
  mediaVideo: '/api/media/video',
  mediaRender: '/api/media/render',
  // video translate (automated pipeline: upload → STT → translate → TTS → render)
  videoTranslate: '/api/video-translate',
  videoTranslateProbe: '/api/video-translate/probe',
  videoTranslateUploadVideo: '/api/video-translate/upload-video',
  videoTranslateUploadLogo: '/api/video-translate/upload-logo',
  videoTranslateDefaultLogo: '/api/video-translate/default-logo',
  videoTranslateJob: (id: string) => `/api/video-translate/${id}`,
  videoTranslateJobStart: (id: string) => `/api/video-translate/${id}/start`,
  videoTranslateJobStatus: (id: string) => `/api/video-translate/${id}/status`,
  videoTranslateJobCancel: (id: string) => `/api/video-translate/${id}/cancel`,
  videoTranslateJobRetry: (id: string) => `/api/video-translate/${id}/retry`,
  // jobs
  jobs: '/api/jobs',
  job: (id: string) => `/api/jobs/${id}`,
  // history
  history: '/api/history',
  // statistics
  statistics: '/api/statistics',
  // settings
  settings: '/api/settings',
  // projects
  projects: '/api/projects',
  // updates
  updatesManifest: '/api/updates/manifest',
  updatesCheck: '/api/updates/check',
  updatesDownload: '/api/updates/download',
  updatesDiagnostics: '/api/updates/diagnostics',
} as const;

export const AI_PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  qwen: 'Qwen / DashScope',
  local: 'LLM cục bộ (Ollama)',
};

export const SUBTITLE_TRANSLATION_SYSTEM_PROMPT = `You are a professional Vietnamese subtitle translator.

You have access to previous episode translations as conversation history. Use them to maintain consistency for character names, nicknames, titles, relationships, and speaking style.

Requirements:

* Translate every subtitle segment from Chinese to Vietnamese.
* Never copy source Chinese characters into the output. Translate names, titles, on-screen text, reactions, and dialogue into Vietnamese; use a Vietnamese phonetic reading for a proper name when needed.
* Keep names, nicknames, titles, and forms of address consistent with previous translations whenever available.
* If a name, title, or term of address has not appeared before, choose a natural Vietnamese equivalent and remain consistent within the current response.
* Subtitles must be concise and suitable for on-screen timing.
* Use natural spoken Vietnamese. Avoid overly formal, literary, or unnecessarily Sino-Vietnamese wording.
* Preserve the original meaning, tone, emotion, and intent.
* Do not censor, soften, summarize, or reinterpret content.
* Translate everything exactly as intended by the source.
* Keep line-by-line correspondence. Do not merge, split, reorder, or omit segments.
* Every segment MUST contain meaningful translated text.
* Never return empty strings or text with no content such as ".".
* Never use placeholders such as ".", "...", "-", "[inaudible]", "[unknown]", or similar unless they are explicitly present in the source dialogue and should be translated.
* If the source contains only a name, exclamation, reaction, or interjection, translate it naturally rather than leaving it empty.
* Include ALL segments from the input.

Output rules:

* Respond with valid JSON only.
* Do not include Markdown.
* Do not include explanations, notes, comments, or extra text.
* Preserve the original index values exactly.
* Include every segment exactly once.
* The number of output segments must equal the number of input segments.
* Every "text" field must contain a non-empty Vietnamese translation.`;

export const AI_DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.1-flash-lite-preview',
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-latest',
  deepseek: 'deepseek-chat',
  openrouter: 'openai/gpt-4o-mini',
  qwen: 'qwen-plus',
  local: 'llama3.1',
};

export function resolveAIModel(provider: string, model?: string | null): string {
  if (provider === 'gemini' && (
    !model ||
    model === 'gemini-3-flash-preview' ||
    model === 'gemini-2.0-flash-exp' ||
    model === 'gemini-1.5-flash'
  )) {
    return AI_DEFAULT_MODELS.gemini;
  }
  return model || AI_DEFAULT_MODELS[provider] || '';
}

// Approximate cost per 1M tokens (USD) - input / output
export const AI_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-lite-preview': { input: 0.075, output: 0.3 },
  'gemini-3-flash-preview': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash-exp': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'qwen-plus': { input: 0.4, output: 1.2 },
};

export const SUBTITLE_FORMATS = ['srt', 'ass', 'vtt', 'txt', 'capcut'] as const;

/**
 * Supabase Realtime configuration.
 *
 * The backend uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to broadcast
 * change events; the frontend uses `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
 * to subscribe. When the env vars are missing, realtime silently falls back to
 * the existing TanStack Query polling — the app keeps working in offline mode.
 */
export const REALTIME_CHANNEL_NAME = 'sleiz:realtime';

/** TanStack Query keys that should be invalidated when a given entity changes. */
export const REALTIME_QUERY_MAP: Record<string, string[]> = {
  channels: ['channels', 'channel', 'statistics'],
  movies: ['movies', 'movie', 'movie-workspace', 'statistics'],
  episodes: ['episodes', 'episode', 'movie-workspace', 'statistics'],
  subtitles: ['subtitles', 'subtitle', 'movie-workspace'],
  batches: ['batches', 'subtitle-translate-status', 'movie-workspace'],
  glossary: ['glossary'],
  characters: ['characters'],
  'translation-memory': ['translation-memory'],
  jobs: ['jobs', 'download-status'],
  history: ['history'],
  statistics: ['statistics'],
  settings: ['settings'],
  ai: ['ai-description', 'ai-providers'],
  downloads: ['download-status', 'jobs'],
  workspace: ['movie-workspace', 'episodes', 'subtitles', 'batches'],
};

/** Polling intervals (ms) — used as fallback when realtime is not connected. */
export const POLL_INTERVALS = {
  jobStatus: 5000,
  downloadStatus: 600,
  translateStatus: 1500,
  workspace: 3000,
  statistics: 30_000,
} as const;

export const GLOSSARY_TYPES = [
  { value: 'name', label: 'Tên nhân vật' },
  { value: 'place', label: 'Địa danh' },
  { value: 'skill', label: 'Kỹ năng / Võ công' },
  { value: 'item', label: 'Vật phẩm' },
  { value: 'title', label: 'Chức danh' },
  { value: 'term', label: 'Thuật ngữ' },
  { value: 'other', label: 'Khác' },
] as const;

export const MOVIE_STATUSES = [
  { value: 'planned', label: 'Lên kế hoạch', color: 'bg-slate-500' },
  { value: 'ongoing', label: 'Đang làm', color: 'bg-blue-500' },
  { value: 'completed', label: 'Hoàn thành', color: 'bg-emerald-500' },
  { value: 'dropped', label: 'Đã bỏ', color: 'bg-rose-500' },
] as const;

export const EPISODE_STATUSES = [
  { value: 'pending', label: 'Chờ xử lý', color: 'bg-slate-500' },
  { value: 'imported', label: 'Đã nhập', color: 'bg-cyan-500' },
  { value: 'translating', label: 'Đang dịch', color: 'bg-amber-500' },
  { value: 'translated', label: 'Đã dịch', color: 'bg-blue-500' },
  { value: 'reviewing', label: 'Đang soát', color: 'bg-violet-500' },
  { value: 'completed', label: 'Hoàn thành', color: 'bg-emerald-500' },
  { value: 'exported', label: 'Đã xuất', color: 'bg-teal-500' },
] as const;

export const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Tổng quan', icon: 'home', shortcut: 'Alt+1' },
  { id: 'channel', label: 'Kênh', icon: 'tv', shortcut: 'Alt+2' },
  { id: 'movie', label: 'Bộ phim', icon: 'film', shortcut: 'Alt+3' },
  { id: 'download', label: 'Tải phim', icon: 'cloud-download', shortcut: 'Alt+D' },
  { id: 'settings', label: 'Cài đặt', icon: 'settings', shortcut: 'Alt+,' },
] as const;

export type SidebarId = (typeof SIDEBAR_ITEMS)[number]['id'];
