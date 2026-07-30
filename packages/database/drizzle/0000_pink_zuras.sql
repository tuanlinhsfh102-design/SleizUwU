CREATE TABLE `ai_descriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`title` text,
	`youtube_description` text,
	`introduction` text,
	`highlights` text,
	`call_to_action` text,
	`donate_message` text,
	`hashtags` text,
	`seo_keywords` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`subtitle_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`start_cue` integer NOT NULL,
	`end_cue` integer NOT NULL,
	`total_cues` integer NOT NULL,
	`processed_cues` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider` text,
	`model` text,
	`token_input` integer,
	`token_output` integer,
	`cost_usd` real,
	`duration_ms` integer,
	`error` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subtitle_id`) REFERENCES `subtitles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`avatar` text,
	`banner` text,
	`youtube` text,
	`tiktok` text,
	`facebook` text,
	`discord` text,
	`website` text,
	`email` text,
	`donate_info` text,
	`bank_name` text,
	`bank_account_number` text,
	`bank_account_name` text,
	`template_description` text,
	`template_hashtag` text,
	`template_thumbnail` text,
	`ai_prompt` text,
	`ai_provider` text,
	`ai_model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_slug_unique` ON `channels` (`slug`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`movie_id` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text,
	`gender` text,
	`role` text,
	`honorific` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`movie_id` text NOT NULL,
	`title` text NOT NULL,
	`episode_number` integer NOT NULL,
	`thumbnail` text,
	`video_path` text,
	`subtitle_id` text,
	`duration` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `glossary` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`movie_id` text,
	`original` text NOT NULL,
	`translated` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`pinyin` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text,
	`details` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`result` text,
	`error` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`title_vi` text NOT NULL,
	`title_zh` text NOT NULL,
	`title_en` text,
	`aliases` text,
	`thumbnail` text,
	`poster` text,
	`banner` text,
	`studio` text,
	`genres` text,
	`year` integer,
	`country` text,
	`director` text,
	`author` text,
	`description` text,
	`tags` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`movie_id` text,
	`episode_id` text,
	`description` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`default_provider` text DEFAULT 'gemini' NOT NULL,
	`default_model` text DEFAULT 'gemini-3.1-flash-lite-preview' NOT NULL,
	`temperature` real DEFAULT 0.3 NOT NULL,
	`concurrency` integer DEFAULT 3 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`batch_size` integer DEFAULT 100 NOT NULL,
	`gemini_api_key` text,
	`gemini_api_keys` text,
	`openai_api_key` text,
	`claude_api_key` text,
	`deepseek_api_key` text,
	`openrouter_api_key` text,
	`qwen_api_key` text,
	`groq_api_key` text,
	`revid_api_key` text,
	`tiktok_session_id` text,
	`theme` text DEFAULT 'dark' NOT NULL,
	`language` text DEFAULT 'vi' NOT NULL,
	`sidebar_collapsed` integer DEFAULT 0 NOT NULL,
	`proxy` text,
	`mongodb_uri` text,
	`github_private_repo` text,
	`github_private_token` text,
	`update_asset_name` text,
	`bilibili_cookie` text,
	`total_tokens_used` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`download_path` text,
	`download_concurrency` integer DEFAULT 3 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`format` text NOT NULL,
	`language` text DEFAULT 'zh' NOT NULL,
	`cues` text DEFAULT '[]' NOT NULL,
	`source_path` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `translation_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`source_text` text NOT NULL,
	`source_hash` text NOT NULL,
	`target_text` text NOT NULL,
	`provider` text,
	`movie_id` text,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_translation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text,
	`movie_id` text,
	`original_video_path` text NOT NULL,
	`extracted_audio_path` text,
	`original_srt_path` text,
	`translated_srt_path` text,
	`tts_audio_path` text,
	`output_video_path` text,
	`thumbnail_path` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`current_step` text,
	`total_steps` integer DEFAULT 7 NOT NULL,
	`error` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE set null
);
