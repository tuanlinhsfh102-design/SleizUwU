/**
 * Video translation service - orchestrates the complete workflow
 */

import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { transcribeAudioToSRT } from '@sleiz/capcut-stt';
import { createTTSClient } from '@sleiz/tiktok';
import { processVideoComplete } from '@sleiz/video-processor';
import { parseSubtitle, exportSrt } from '@sleiz/subtitle';
import { translateSubtitle } from './translate.js';
import { join, dirname, basename, extname } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { rt } from './realtime.js';

function ensureVideoTranslationEpisode(db: DB, job: typeof schema.videoTranslationJobs.$inferSelect): { movieId: string; episodeId: string } {
  const now = Math.floor(Date.now() / 1000);

  if (job.episodeId) {
    const existingEpisode = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, job.episodeId))
      .get();
    if (existingEpisode) {
      return { movieId: existingEpisode.movieId, episodeId: existingEpisode.id };
    }
  }

  let movieId = job.movieId || '';
  if (movieId) {
    const existingMovie = db
      .select()
      .from(schema.movies)
      .where(eq(schema.movies.id, movieId))
      .get();
    if (!existingMovie) {
      movieId = '';
    }
  }

  if (!movieId) {
    const channelId = `temp-channel-${job.id}`;
    const existingChannel = db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, channelId))
      .get();
    if (!existingChannel) {
      db.insert(schema.channels)
        .values({
          id: channelId,
          name: `Video Translation ${job.id.slice(0, 8)}`,
          slug: `video-translation-${job.id.toLowerCase()}`,
          description: 'Temporary channel for standalone video translation jobs',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    movieId = `temp-movie-${job.id}`;
    const existingMovie = db
      .select()
      .from(schema.movies)
      .where(eq(schema.movies.id, movieId))
      .get();
    if (!existingMovie) {
      db.insert(schema.movies)
        .values({
          id: movieId,
          channelId,
          titleVi: `Video Translation ${job.id.slice(0, 8)}`,
          titleZh: `Video Translation ${job.id.slice(0, 8)}`,
          status: 'processing',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  const episodeId = `temp-episode-${job.id}`;
  const existingEpisode = db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.id, episodeId))
    .get();
  if (!existingEpisode) {
    db.insert(schema.episodes)
      .values({
        id: episodeId,
        movieId,
        title: `Video Translation ${job.id.slice(0, 8)}`,
        episodeNumber: 1,
        videoPath: job.originalVideoPath,
        status: 'processing',
        metadata: JSON.stringify({ temporary: true, source: 'video-translation' }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  db.update(schema.videoTranslationJobs)
    .set({
      movieId,
      episodeId,
      updatedAt: now,
    })
    .where(eq(schema.videoTranslationJobs.id, job.id))
    .run();

  return { movieId, episodeId };
}

/**
 * Main video translation processing function
 * 
 * Workflow:
 * 1. Extract audio from video
 * 2. Convert audio to SRT using CapCut STT
 * 3. Translate SRT from Chinese to Vietnamese
 * 4. Convert translated SRT to audio using TikTok TTS
 * 5. Process video: blur Chinese text, add Vietnamese subtitles, add logo, crop to 16:9
 * 6. Replace original audio with translated audio
 * 7. Generate thumbnail
 */
export async function processVideoTranslation(db: DB, jobId: string): Promise<void> {
  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, jobId))
    .get();

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const settings = JSON.parse(job.settings || '{}') as {
    voice: string;
    logoPath?: string;
    cropTo16x9: boolean;
    blurIntensity: number;
    logoPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    logoScale: number;
    ttsSpeed?: number;             // 0.5–2.0
    ttsVolume?: number;            // 0.0–3.0
    originalAudioMode?: 'replace' | 'mix';
    originalAudioVolume?: number;  // 0.0–1.0
  };

  const storageDir = process.env.STORAGE_DIR || './data/storage';
  const jobDir = join(storageDir, 'video-translate', jobId);
  await mkdir(jobDir, { recursive: true });

  const videoPath = job.originalVideoPath;
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const videoBaseName = basename(videoPath, extname(videoPath));

  try {
    // Get settings from database
    const settingsRow = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, 'default'))
      .get();

    if (!settingsRow) {
      throw new Error('Settings not found in database');
    }

    // Step 1: Extract audio (handled by video processor, but we need it for STT)
    updateJobProgress(db, jobId, 'extracting_audio', 10, 'Extracting audio from video...');
    
    const { extractAudio } = await import('@sleiz/video-processor');
    const audioPath = join(jobDir, `${videoBaseName}_audio.mp3`);
    await extractAudio(videoPath, audioPath);
    
    db.update(schema.videoTranslationJobs)
      .set({ extractedAudioPath: audioPath })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    // Step 2: Audio to SRT using CapCut STT
    updateJobProgress(db, jobId, 'transcribing', 25, 'Converting audio to Chinese subtitles...');
    
    const sttResult = await transcribeAudioToSRT(audioPath, 'zh-CN', true);
    
    if (!sttResult.srt) {
      throw new Error('STT failed: No SRT content returned');
    }

    const originalSrtPath = join(jobDir, `${videoBaseName}_original.srt`);
    await writeFile(originalSrtPath, sttResult.srt, 'utf-8');
    
    db.update(schema.videoTranslationJobs)
      .set({ originalSrtPath })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    // Step 3: Parse and translate SRT
    updateJobProgress(db, jobId, 'translating', 40, 'Translating to Vietnamese...');
    
    const parsed = await parseSubtitle(sttResult.srt, originalSrtPath, { language: 'zh' });
    const translationContext = ensureVideoTranslationEpisode(db, job);
    
    // Create a temporary subtitle record for translation
    const subtitleId = `temp_${jobId}`;
    const now = Math.floor(Date.now() / 1000);
    
    db.insert(schema.subtitles)
      .values({
        id: subtitleId,
        episodeId: translationContext.episodeId,
        format: 'srt',
        language: 'zh',
        cues: JSON.stringify(parsed.cues),
        sourcePath: originalSrtPath,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Translate using existing translation service
    const translateOptions = {
      provider: settingsRow.defaultProvider,
      model: settingsRow.defaultModel,
      channelId: undefined,
      movieId: translationContext.movieId,
      batchSize: settingsRow.batchSize,
    };

    await translateSubtitle(db, subtitleId, translateOptions);

    // Get translated cues
    const translatedSubtitle = db
      .select()
      .from(schema.subtitles)
      .where(eq(schema.subtitles.id, subtitleId))
      .get();

    if (!translatedSubtitle) {
      throw new Error('Translation failed: Subtitle not found after translation');
    }

    const translatedCues = JSON.parse(translatedSubtitle.cues);
    
    // Export to SRT
    const translatedSrtPath = join(jobDir, `${videoBaseName}_translated.srt`);
    const translatedSrtContent = exportSrt(translatedCues, { preferTranslated: true });
    await writeFile(translatedSrtPath, translatedSrtContent, 'utf-8');
    
    db.update(schema.videoTranslationJobs)
      .set({ translatedSrtPath })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    // Clean up temporary subtitle
    db.delete(schema.subtitles)
      .where(eq(schema.subtitles.id, subtitleId))
      .run();

    // Step 4: TTS - Convert translated SRT to audio
    updateJobProgress(db, jobId, 'generating_tts', 55, 'Generating Vietnamese audio...');
    
    if (!settingsRow.tiktokSessionId) {
      throw new Error('TikTok session ID not configured. Please set it in Settings.');
    }

    const ttsClient = createTTSClient(settingsRow.tiktokSessionId);
    const ttsResult = await ttsClient.srtToAudio(translatedCues, {
      voice: settings.voice,
      outputDir: jobDir,
      outputFilename: `${videoBaseName}_tts.mp3`,
      // Pass speed + volume so FFmpeg applies them in a single pass during merge.
      speed: settings.ttsSpeed ?? 1.0,
      volume: settings.ttsVolume ?? 1.0,
      onProgress: (current, total, message) => {
        const progress = 55 + Math.floor((current / total) * 15);
        updateJobProgress(db, jobId, 'generating_tts', progress, message);
      },
    });

    if (!ttsResult.success || !ttsResult.audioPath) {
      throw new Error(`TTS failed: ${ttsResult.error || 'Unknown error'}`);
    }

    const ttsAudioPath = ttsResult.audioPath;
    
    db.update(schema.videoTranslationJobs)
      .set({ ttsAudioPath })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    // Step 5-7: Video processing (blur, subtitles, logo, crop, audio replacement)
    updateJobProgress(db, jobId, 'processing_video', 70, 'Processing video...');

    const outputDir = join(jobDir, 'output');
    await mkdir(outputDir, { recursive: true });

    const processingResult = await processVideoComplete(
      videoPath,
      translatedSrtPath,
      ttsAudioPath,
      {
        outputDir,
        logoPath: settings.logoPath,
        logoPosition: settings.logoPosition,
        logoScale: settings.logoScale,
        blurIntensity: settings.blurIntensity,
        cropTo16x9: settings.cropTo16x9,
        // Audio mixing: 'replace' fully mutes original audio, 'mix' keeps
        // the original at the specified volume alongside the TTS track.
        originalAudioMode: settings.originalAudioMode ?? 'replace',
        originalAudioVolume: settings.originalAudioVolume ?? 0,
        onProgress: (step, progress, message) => {
          const overallProgress = 70 + Math.floor(progress * 0.25);
          updateJobProgress(db, jobId, 'processing_video', overallProgress, `${step}: ${message || ''}`);
        },
      }
    );

    if (!processingResult.success || !processingResult.outputVideoPath) {
      throw new Error(`Video processing failed: ${processingResult.error || 'Unknown error'}`);
    }

    // Update final job status
    const completedAt = Math.floor(Date.now() / 1000);
    
    db.update(schema.videoTranslationJobs)
      .set({
        outputVideoPath: processingResult.outputVideoPath,
        thumbnailPath: processingResult.thumbnailPath,
        status: 'completed',
        progress: 100,
        currentStep: 'completed',
        metadata: JSON.stringify({
          ...JSON.parse(job.metadata || '{}'),
          videoMetadata: processingResult.metadata,
          processingSteps: processingResult.processingSteps,
        }),
        updatedAt: completedAt,
        completedAt,
      })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    rt.updated('video_translation_jobs', jobId, { 
      movieId: job.movieId, 
      episodeId: job.episodeId 
    });

    console.log(`[video-translate] Job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`[video-translate] Job ${jobId} failed:`, error);
    
    db.update(schema.videoTranslationJobs)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(schema.videoTranslationJobs.id, jobId))
      .run();

    rt.updated('video_translation_jobs', jobId, { 
      movieId: job.movieId, 
      episodeId: job.episodeId 
    });

    throw error;
  }
}

/**
 * Update job progress in database and broadcast via realtime
 */
function updateJobProgress(
  db: DB,
  jobId: string,
  step: string,
  progress: number,
  message?: string
): void {
  db.update(schema.videoTranslationJobs)
    .set({
      currentStep: step,
      progress: Math.min(100, Math.max(0, progress)),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.videoTranslationJobs.id, jobId))
    .run();

  const job = db
    .select()
    .from(schema.videoTranslationJobs)
    .where(eq(schema.videoTranslationJobs.id, jobId))
    .get();

  if (job) {
    rt.updated('video_translation_jobs', jobId, { 
      movieId: job.movieId, 
      episodeId: job.episodeId 
    });
  }

  if (message) {
    console.log(`[video-translate] ${jobId}: ${message}`);
  }
}
