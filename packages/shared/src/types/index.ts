/**
 * Domain types for Sleiz Studio.
 * All entities live here so the API, web, and desktop apps share one source of truth.
 */

// ============================================================================
// Channel
// ============================================================================
export interface Channel {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  avatar?: string | null;
  banner?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  discord?: string | null;
  website?: string | null;
  email?: string | null;
  donateInfo?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  templateDescription?: string | null;
  templateHashtag?: string | null;
  templateThumbnail?: string | null;
  aiPrompt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelInput {
  name: string;
  slug?: string;
  description?: string | null;
  avatar?: string | null;
  banner?: string | null;
  youtube?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  discord?: string | null;
  website?: string | null;
  email?: string | null;
  donateInfo?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  templateDescription?: string | null;
  templateHashtag?: string | null;
  templateThumbnail?: string | null;
  aiPrompt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
}

// ============================================================================
// Movie
// ============================================================================
export type MovieStatus = 'planned' | 'ongoing' | 'completed' | 'dropped';

export interface Movie {
  id: string;
  channelId: string;
  titleVi: string;
  titleZh: string;
  titleEn?: string | null;
  aliases?: string | null;
  thumbnail?: string | null;
  poster?: string | null;
  banner?: string | null;
  studio?: string | null;
  genres?: string | null;
  year?: number | null;
  country?: string | null;
  director?: string | null;
  author?: string | null;
  description?: string | null;
  tags?: string | null;
  status: MovieStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MovieInput {
  channelId: string;
  titleVi: string;
  titleZh: string;
  titleEn?: string | null;
  aliases?: string | null;
  thumbnail?: string | null;
  poster?: string | null;
  banner?: string | null;
  studio?: string | null;
  genres?: string | null;
  year?: number | null;
  country?: string | null;
  director?: string | null;
  author?: string | null;
  description?: string | null;
  tags?: string | null;
  status?: MovieStatus;
}

// ============================================================================
// Episode
// ============================================================================
export type EpisodeStatus = 'pending' | 'imported' | 'translating' | 'translated' | 'reviewing' | 'completed' | 'exported';

export interface Episode {
  id: string;
  movieId: string;
  title: string;
  episodeNumber: number;
  thumbnail?: string | null;
  videoPath?: string | null;
  subtitleId?: string | null;
  duration?: number | null;
  status: EpisodeStatus;
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeInput {
  movieId: string;
  title: string;
  episodeNumber: number;
  thumbnail?: string | null;
  videoPath?: string | null;
  duration?: number | null;
  status?: EpisodeStatus;
  metadata?: Record<string, unknown> | null;
}

// ============================================================================
// Subtitle
// ============================================================================
export type SubtitleFormat = 'srt' | 'ass' | 'vtt' | 'txt' | 'capcut';

export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  textOriginal: string;
  textTranslated?: string | null;
  status: 'pending' | 'translating' | 'translated' | 'reviewed' | 'error';
  speaker?: string | null;
  note?: string | null;
}

export interface Subtitle {
  id: string;
  episodeId: string;
  format: SubtitleFormat;
  language: string;
  cues: SubtitleCue[];
  sourcePath?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitleInput {
  episodeId: string;
  format: SubtitleFormat;
  language?: string;
  cues: SubtitleCue[];
  sourcePath?: string | null;
}

// ============================================================================
// Batch (Translation batch)
// ============================================================================
export type BatchStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Batch {
  id: string;
  episodeId: string;
  subtitleId: string;
  batchIndex: number;
  startCue: number;
  endCue: number;
  totalCues: number;
  processedCues: number;
  status: BatchStatus;
  provider?: string | null;
  model?: string | null;
  tokenInput?: number | null;
  tokenOutput?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
  error?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Glossary
// ============================================================================
export interface GlossaryEntry {
  id: string;
  channelId?: string | null;
  movieId?: string | null;
  original: string;
  translated: string;
  type: 'name' | 'place' | 'skill' | 'item' | 'title' | 'term' | 'other';
  pinyin?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryInput {
  channelId?: string | null;
  movieId?: string | null;
  original: string;
  translated: string;
  type?: GlossaryEntry['type'];
  pinyin?: string | null;
  note?: string | null;
}

// ============================================================================
// Character
// ============================================================================
export interface Character {
  id: string;
  movieId: string;
  name: string;
  aliases?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  role?: string | null;
  honorific?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Translation Memory
// ============================================================================
export interface TranslationMemory {
  id: string;
  sourceText: string;
  sourceHash: string;
  targetText: string;
  provider?: string | null;
  movieId?: string | null;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// History
// ============================================================================
export type HistoryAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'import'
  | 'export'
  | 'translate'
  | 'download'
  | 'convert'
  | 'review'
  | 'restore';

export interface HistoryEntry {
  id: string;
  action: HistoryAction;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  details?: string | null;
  metadata?: string | null;
  createdAt: string;
}

// ============================================================================
// Project
// ============================================================================
export interface Project {
  id: string;
  name: string;
  movieId?: string | null;
  episodeId?: string | null;
  description?: string | null;
  version: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Settings
// ============================================================================
export interface AppSettings {
  id: string;
  // AI
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
  concurrency: number;
  maxRetries: number;
  batchSize: number;
  // API keys (encrypted at rest)
  geminiApiKey?: string | null;
  /** Multiple Gemini API keys (newline/comma separated in DB; array when parsed). */
  geminiApiKeys?: string[];
  openaiApiKey?: string | null;
  claudeApiKey?: string | null;
  deepseekApiKey?: string | null;
  openrouterApiKey?: string | null;
  qwenApiKey?: string | null;
  groqApiKey?: string | null;
  revidApiKey?: string | null;
  // UI
  theme: 'dark' | 'light' | 'system';
  language: 'vi' | 'en' | 'zh';
  sidebarCollapsed: boolean;
  // Network
  proxy?: string | null;
  mongodbUri?: string | null;
  githubPrivateRepo?: string | null;
  githubPrivateToken?: string | null;
  updateAssetName?: string | null;
  hasMongoUri?: boolean;
  hasGithubPrivateToken?: boolean;
  hasBilibiliCookie?: boolean;
  hasGeminiKey?: boolean;
  /** Count of configured Gemini API keys (1+ when hasGeminiKey is true). */
  geminiKeysCount?: number;
  hasOpenaiKey?: boolean;
  hasClaudeKey?: boolean;
  hasDeepseekKey?: boolean;
  hasOpenrouterKey?: boolean;
  hasQwenKey?: boolean;
  hasGroqKey?: boolean;
  hasRevidKey?: boolean;
  // Bilibili
  bilibiliCookie?: string | null;
  // Download settings
  downloadPath?: string | null;
  downloadConcurrency?: number;
  // Cost tracking
  totalTokensUsed: number;
  totalCostUsd: number;
  updatedAt: string;
}

// ============================================================================
// AI Providers
// ============================================================================
export type AIProviderType =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'deepseek'
  | 'openrouter'
  | 'qwen'
  | 'local';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface TranslateOpts {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
  /** Per-request deadline; providers may use a suitable default when omitted. */
  timeoutMs?: number;
}

export interface AIResult {
  text: string;
  usage: AIUsage;
  provider: AIProviderType;
  model: string;
  durationMs: number;
}

export interface AIProviderConfig {
  provider: AIProviderType;
  model: string;
  apiKey: string;
  temperature?: number;
  baseUrl?: string;
}

// ============================================================================
// Job Queue
// ============================================================================
export type JobType =
  | 'translate_batch'
  | 'download_video'
  | 'download_subtitle'
  | 'convert_subtitle'
  | 'generate_description'
  | 'generate_thumbnail'
  | 'export_subtitle'
  | 'consistency_check'
  | 'proofreading'
  | 'render_video';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: string;
  result?: string | null;
  error?: string | null;
  progress: number;
  total: number;
  retryCount: number;
  maxRetries: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// AI Description
// ============================================================================
export interface AIDescription {
  id: string;
  episodeId: string;
  title?: string | null;
  youtubeDescription?: string | null;
  introduction?: string | null;
  highlights?: string | null;
  callToAction?: string | null;
  donateMessage?: string | null;
  hashtags?: string | null;
  seoKeywords?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Bilibili
// ============================================================================
export interface BilibiliVideoInfo {
  kind: 'video' | 'ugc-season' | 'bangumi';
  bvid: string;
  aid: number;
  title: string;
  desc: string;
  cover: string;
  uploader: string;
  uploaderMid: number;
  duration: number;
  pubdate: number;
  seasonId?: number | null;
  mediaId?: number | null;
  isPlaylist?: boolean;
  episodes: BilibiliEpisode[];
}

export interface BilibiliEpisode {
  id: number;
  title: string;
  aid: number;
  cid: number;
  duration: number;
  cover?: string;
  bvid?: string | null;
  url?: string | null;
  sectionTitle?: string | null;
  epId?: number | null;
}

export interface BilibiliSubtitle {
  lan: string;
  lanDoc: string;
  subtitleUrl: string;
  aiType: number;
}

// ============================================================================
// Download progress
// ============================================================================
export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'error';

export interface DownloadProgress {
  jobId: string;
  source: 'tiktok' | 'bilibili';
  kind: 'video' | 'music';
  filename: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  speedBps: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
  filePath?: string;
  fileSize?: number;
  durationMs?: number;
  mimeType?: string;
  from?: string;
}

// ============================================================================
// Realtime events (Supabase Broadcast)
// ============================================================================
/**
 * Entity types that can be broadcasted over Supabase Realtime.
 * Every mutating API route emits one of these events so all connected
 * web/desktop clients can invalidate their TanStack Query caches.
 */
export type RealtimeEntity =
  | 'channels'
  | 'movies'
  | 'episodes'
  | 'subtitles'
  | 'batches'
  | 'glossary'
  | 'characters'
  | 'translation-memory'
  | 'jobs'
  | 'history'
  | 'statistics'
  | 'settings'
  | 'ai'
  | 'downloads'
  | 'workspace';

export type RealtimeOp = 'create' | 'update' | 'delete' | 'progress' | 'clear';

/**
 * Standard envelope pushed by the API server to the `sleiz:realtime` channel.
 * Frontend `useRealtimeSync` listens for these and invalidates the matching
 * query keys.
 */
export interface RealtimeEvent {
  /** Server timestamp in ms — used for dedup / ordering. */
  ts: number;
  /** Which entity collection changed. */
  entity: RealtimeEntity;
  /** What kind of change happened. */
  op: RealtimeOp;
  /** Id of the affected record (optional for collection-wide events like `clear`). */
  id?: string;
  /** Optional related ids (e.g. channelId / movieId / episodeId / subtitleId). */
  scope?: {
    channelId?: string;
    movieId?: string;
    episodeId?: string;
    subtitleId?: string;
    jobId?: string;
  };
  /** Optional progress payload — used by translate/download jobs. */
  progress?: {
    done: number;
    total: number;
    failed?: number;
    status?: string;
    percent?: number;
  };
}

/** The single Supabase Realtime channel name used across the app. */
export const REALTIME_CHANNEL = 'sleiz:realtime';
