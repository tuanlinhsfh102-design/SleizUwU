-- Add video translation jobs table
CREATE TABLE IF NOT EXISTS `video_translation_jobs` (
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

-- Add TikTok session ID to settings
ALTER TABLE `settings` ADD COLUMN `tiktok_session_id` text;

-- Add RevID API key to settings (if not exists)
ALTER TABLE `settings` ADD COLUMN `revid_api_key` text;
