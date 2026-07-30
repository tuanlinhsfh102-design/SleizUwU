/**
 * Drizzle ORM schema for Sleiz Studio.
 * Single source of truth for the SQLite database layout.
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = sql`(unixepoch())`;

// ============================================================================
// channels
// ============================================================================
export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  avatar: text('avatar'),
  banner: text('banner'),
  youtube: text('youtube'),
  tiktok: text('tiktok'),
  facebook: text('facebook'),
  discord: text('discord'),
  website: text('website'),
  email: text('email'),
  donateInfo: text('donate_info'),
  bankName: text('bank_name'),
  bankAccountNumber: text('bank_account_number'),
  bankAccountName: text('bank_account_name'),
  templateDescription: text('template_description'),
  templateHashtag: text('template_hashtag'),
  templateThumbnail: text('template_thumbnail'),
  aiPrompt: text('ai_prompt'),
  aiProvider: text('ai_provider'),
  aiModel: text('ai_model'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

// ============================================================================
// movies
// ============================================================================
export const movies = sqliteTable('movies', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  titleVi: text('title_vi').notNull(),
  titleZh: text('title_zh').notNull(),
  titleEn: text('title_en'),
  aliases: text('aliases'),
  thumbnail: text('thumbnail'),
  poster: text('poster'),
  banner: text('banner'),
  studio: text('studio'),
  genres: text('genres'),
  year: integer('year'),
  country: text('country'),
  director: text('director'),
  author: text('author'),
  description: text('description'),
  tags: text('tags'),
  status: text('status').notNull().default('planned'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// episodes
// ============================================================================
export const episodes = sqliteTable('episodes', {
  id: text('id').primaryKey(),
  movieId: text('movie_id')
    .notNull()
    .references(() => movies.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  thumbnail: text('thumbnail'),
  videoPath: text('video_path'),
  subtitleId: text('subtitle_id'),
  duration: integer('duration'),
  status: text('status').notNull().default('pending'),
  metadata: text('metadata'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// subtitles (one per episode, format-agnostic, stores cues as JSON)
// ============================================================================
export const subtitles = sqliteTable('subtitles', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  format: text('format').notNull(),
  language: text('language').notNull().default('zh'),
  cues: text('cues').notNull().default('[]'),
  sourcePath: text('source_path'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// batches (translation batches of N cues)
// ============================================================================
export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  subtitleId: text('subtitle_id')
    .notNull()
    .references(() => subtitles.id, { onDelete: 'cascade' }),
  batchIndex: integer('batch_index').notNull(),
  startCue: integer('start_cue').notNull(),
  endCue: integer('end_cue').notNull(),
  totalCues: integer('total_cues').notNull(),
  processedCues: integer('processed_cues').notNull().default(0),
  status: text('status').notNull().default('queued'),
  provider: text('provider'),
  model: text('model'),
  tokenInput: integer('token_input'),
  tokenOutput: integer('token_output'),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// glossary (channel / movie-scoped term dictionary)
// ============================================================================
export const glossary = sqliteTable('glossary', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  movieId: text('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
  original: text('original').notNull(),
  translated: text('translated').notNull(),
  type: text('type').notNull().default('other'),
  pinyin: text('pinyin'),
  note: text('note'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// characters
// ============================================================================
export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  movieId: text('movie_id')
    .notNull()
    .references(() => movies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  aliases: text('aliases'),
  gender: text('gender'),
  role: text('role'),
  honorific: text('honorific'),
  description: text('description'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// translation_memory (cache of past translations to skip duplicate AI calls)
// ============================================================================
export const translationMemory = sqliteTable('translation_memory', {
  id: text('id').primaryKey(),
  sourceText: text('source_text').notNull(),
  sourceHash: text('source_hash').notNull(),
  targetText: text('target_text').notNull(),
  provider: text('provider'),
  movieId: text('movie_id'),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// history (audit log)
// ============================================================================
export const history = sqliteTable('history', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  entityName: text('entity_name'),
  details: text('details'),
  metadata: text('metadata'),
  createdAt: integer('created_at').notNull().default(now),
});

// ============================================================================
// projects (translation projects with version history)
// ============================================================================
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  movieId: text('movie_id').references(() => movies.id, { onDelete: 'set null' }),
  episodeId: text('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
  description: text('description'),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// ai_descriptions (generated YouTube description, hashtags, SEO)
// ============================================================================
export const aiDescriptions = sqliteTable('ai_descriptions', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  title: text('title'),
  youtubeDescription: text('youtube_description'),
  introduction: text('introduction'),
  highlights: text('highlights'),
  callToAction: text('call_to_action'),
  donateMessage: text('donate_message'),
  hashtags: text('hashtags'),
  seoKeywords: text('seo_keywords'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// jobs (async job queue)
// ============================================================================
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(0),
  payload: text('payload').notNull().default('{}'),
  result: text('result'),
  error: text('error'),
  progress: integer('progress').notNull().default(0),
  total: integer('total').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

// ============================================================================
// video_translation_jobs (automated video translation pipeline)
// ============================================================================
export const videoTranslationJobs = sqliteTable('video_translation_jobs', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
  movieId: text('movie_id').references(() => movies.id, { onDelete: 'set null' }),
  originalVideoPath: text('original_video_path').notNull(),
  extractedAudioPath: text('extracted_audio_path'),
  originalSrtPath: text('original_srt_path'),
  translatedSrtPath: text('translated_srt_path'),
  ttsAudioPath: text('tts_audio_path'),
  outputVideoPath: text('output_video_path'),
  thumbnailPath: text('thumbnail_path'),
  status: text('status').notNull().default('queued'),
  // Status values: queued, uploading, extracting_audio, transcribing, translating, generating_tts, processing_video, completed, failed
  progress: integer('progress').notNull().default(0),
  currentStep: text('current_step'),
  totalSteps: integer('total_steps').notNull().default(7),
  error: text('error'),
  settings: text('settings').notNull().default('{}'),
  // Settings JSON: { voice, logoPath, logoPosition, cropMode, blurIntensity, textStyle }
  metadata: text('metadata').default('{}'),
  // Metadata JSON: { originalDuration, videoCodec, audioCodec, resolution, fps, detectedTexts }
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
  completedAt: integer('completed_at'),
});

// ============================================================================
// settings (single-row table)
// ============================================================================
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().default('default'),
  defaultProvider: text('default_provider').notNull().default('gemini'),
  defaultModel: text('default_model').notNull().default('gemini-3.1-flash-lite-preview'),
  temperature: real('temperature').notNull().default(0.3),
  concurrency: integer('concurrency').notNull().default(3),
  maxRetries: integer('max_retries').notNull().default(3),
  batchSize: integer('batch_size').notNull().default(100),
  // Encrypted API keys (cipher text)
  geminiApiKey: text('gemini_api_key'),
  // Comma/newline-separated list of Gemini API keys (JSON string).
  // Used for round-robin rotation when multiple keys are configured.
  geminiApiKeys: text('gemini_api_keys'),
  openaiApiKey: text('openai_api_key'),
  claudeApiKey: text('claude_api_key'),
  deepseekApiKey: text('deepseek_api_key'),
  openrouterApiKey: text('openrouter_api_key'),
  qwenApiKey: text('qwen_api_key'),
  groqApiKey: text('groq_api_key'),
  revidApiKey: text('revid_api_key'),
  tiktokSessionId: text('tiktok_session_id'),
  // UI
  theme: text('theme').notNull().default('dark'),
  language: text('language').notNull().default('vi'),
  sidebarCollapsed: integer('sidebar_collapsed').notNull().default(0),
  // Network
  proxy: text('proxy'),
  mongodbUri: text('mongodb_uri'),
  githubPrivateRepo: text('github_private_repo'),
  githubPrivateToken: text('github_private_token'),
  updateAssetName: text('update_asset_name'),
  bilibiliCookie: text('bilibili_cookie'),
  // Cost tracking
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  // Download settings
  downloadPath: text('download_path'),
  downloadConcurrency: integer('download_concurrency').notNull().default(3),
  updatedAt: integer('updated_at').notNull().default(now),
});
