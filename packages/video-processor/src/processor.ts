/**
 * High-level video processing workflow
 */

import { join, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  extractAudio,
  getVideoMetadata,
  cropTo169,
  detectChineseTextRegions,
  blurRegions,
  blurAndBurnSubtitles,
  addLogo,
  burnSubtitles,
  replaceAudio,
  generateThumbnail,
  type VideoMetadata,
} from './ffmpeg.js';

export interface ProcessingOptions {
  outputDir: string;
  logoPath?: string;
  logoPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  logoScale?: number;
  blurIntensity?: number;
  cropTo16x9?: boolean;
  subtitleStyle?: {
    fontName?: string;
    fontSize?: number;
    primaryColor?: string;
    outlineColor?: string;
  };
  /** Audio mixing strategy for the final replace-audio step.
   *  - 'replace' (default): mute original audio, use only TTS
   *  - 'mix': keep original audio at originalAudioVolume alongside TTS
   */
  originalAudioMode?: 'replace' | 'mix';
  /** Volume multiplier for the original audio track (0.0–1.0).
   *  Only used when originalAudioMode='mix'. */
  originalAudioVolume?: number;
  onProgress?: (step: string, progress: number, message?: string) => void;
}

export interface ProcessingResult {
  success: boolean;
  outputVideoPath?: string;
  thumbnailPath?: string;
  extractedAudioPath?: string;
  metadata?: VideoMetadata;
  error?: string;
  processingSteps: Array<{
    step: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
}

/**
 * Complete video processing pipeline:
 * 1. Extract audio
 * 2. Detect text regions
 * 3. Blur text regions
 * 4. Crop to 16:9 (optional)
 * 5. Burn translated subtitles
 * 6. Add logo watermark
 * 7. Replace audio with translated TTS
 * 8. Generate thumbnail
 */
export async function processVideoComplete(
  inputVideoPath: string,
  translatedSrtPath: string,
  ttsAudioPath: string,
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    success: false,
    processingSteps: [],
  };

  const startTime = Date.now();

  try {
    // Validate inputs
    if (!existsSync(inputVideoPath)) {
      throw new Error(`Input video not found: ${inputVideoPath}`);
    }
    if (!existsSync(translatedSrtPath)) {
      throw new Error(`Translated SRT not found: ${translatedSrtPath}`);
    }
    if (!existsSync(ttsAudioPath)) {
      throw new Error(`TTS audio not found: ${ttsAudioPath}`);
    }

    // Ensure output directory exists
    await mkdir(options.outputDir, { recursive: true });

    const videoBaseName = basename(inputVideoPath, extname(inputVideoPath));
    const tempDir = join(options.outputDir, 'temp');
    await mkdir(tempDir, { recursive: true });

    // Step 1: Get video metadata
    const stepStart1 = Date.now();
    options.onProgress?.('metadata', 0, 'Reading video metadata...');
    
    result.metadata = await getVideoMetadata(inputVideoPath);
    
    result.processingSteps.push({
      step: 'metadata',
      success: true,
      duration: Date.now() - stepStart1,
    });
    options.onProgress?.('metadata', 100, 'Metadata extracted');

    // Step 2: Extract audio (for backup/reference)
    const stepStart2 = Date.now();
    options.onProgress?.('extract_audio', 0, 'Extracting audio...');
    
    result.extractedAudioPath = join(tempDir, `${videoBaseName}_original_audio.mp3`);
    await extractAudio(
      inputVideoPath,
      result.extractedAudioPath,
      (progress) => options.onProgress?.('extract_audio', progress)
    );
    
    result.processingSteps.push({
      step: 'extract_audio',
      success: true,
      duration: Date.now() - stepStart2,
    });

    // Step 3: Detect Chinese text regions using OCR (Tesseract chi_sim).
    // This finds the ACTUAL position of hardcoded Chinese subtitles in the
    // frame, which varies by video (some put subs at 50%, others at 80%).
    const stepStart3 = Date.now();
    options.onProgress?.('detect_text', 0, 'Detecting Chinese text via OCR...');

    const textRegions = await detectChineseTextRegions(inputVideoPath);

    result.processingSteps.push({
      step: 'detect_text',
      success: true,
      duration: Date.now() - stepStart3,
    });
    options.onProgress?.('detect_text', 100, `Found ${textRegions.length} text region(s)`);

    let currentVideo = inputVideoPath;

    // Step 4: Crop to 16:9 (optional) — do this BEFORE blur+burn so the
    // subtitle band and text are positioned relative to the final frame.
    // Note: OCR regions are relative to the ORIGINAL frame, so if we crop
    // first, we need to adjust region coordinates. For simplicity, we
    // re-run OCR on the cropped video if cropping is enabled.
    if (options.cropTo16x9) {
      const stepStart4 = Date.now();
      options.onProgress?.('crop', 0, 'Cropping to 16:9 (removing black bars)...');

      const croppedPath = join(tempDir, `${videoBaseName}_cropped.mp4`);
      await cropTo169(
        currentVideo,
        croppedPath,
        (progress) => options.onProgress?.('crop', progress)
      );

      currentVideo = croppedPath;

      // Re-run OCR on the cropped video to get accurate region coordinates
      // (the crop may have shifted or removed the subtitle area)
      try {
        const croppedRegions = await detectChineseTextRegions(currentVideo);
        if (croppedRegions.length > 0) {
          textRegions.length = 0;
          textRegions.push(...croppedRegions);
        }
      } catch {
        // Keep original regions if re-OCR fails
      }

      result.processingSteps.push({
        step: 'crop',
        success: true,
        duration: Date.now() - stepStart4,
      });
    }

    // Step 5: Blur Chinese text (using OCR regions) + burn Vietnamese subtitles
    // Single FFmpeg pass: for each OCR region → crop → blur → drawbox(0.85 black)
    // → overlay back → then burn Vietnamese SRT on top at the bottom.
    const stepStart5 = Date.now();
    options.onProgress?.('blur_burn', 0, 'Blurring Chinese text + burning Vietnamese subtitles...');

    const subtitledPath = join(tempDir, `${videoBaseName}_vietsub.mp4`);
    await blurAndBurnSubtitles(
      currentVideo,
      subtitledPath,
      translatedSrtPath,
      {
        blurRegions: textRegions,
        // Frosted-glass blur: sigma 12-18 obscures text while keeping video
        // visible through the blur. Tight OCR regions (padding=6) ensure
        // the blur hugs the text rather than covering a wide band.
        blurStrength: Math.min(12, Math.max(6, options.blurIntensity || 8)),
        fontName: options.subtitleStyle?.fontName || 'Arial',
        fontSize: options.subtitleStyle?.fontSize,
        onProgress: (progress) => options.onProgress?.('blur_burn', progress),
      }
    );

    currentVideo = subtitledPath;

    result.processingSteps.push({
      step: 'blur_burn',
      success: true,
      duration: Date.now() - stepStart5,
    });

    // Step 7: Add logo watermark (optional)
    if (options.logoPath && existsSync(options.logoPath)) {
      const stepStart7 = Date.now();
      options.onProgress?.('add_logo', 0, 'Adding logo watermark...');
      
      const logoPath = join(tempDir, `${videoBaseName}_logo.mp4`);
      await addLogo(
        currentVideo,
        logoPath,
        options.logoPath,
        options.logoPosition || 'top-right',
        options.logoScale || 0.15,
        20,
        (progress) => options.onProgress?.('add_logo', progress)
      );
      
      currentVideo = logoPath;
      
      result.processingSteps.push({
        step: 'add_logo',
        success: true,
        duration: Date.now() - stepStart7,
      });
    }

    // Step 8: Replace audio with TTS
    const stepStart8 = Date.now();
    options.onProgress?.('replace_audio', 0, 'Replacing audio with Vietnamese TTS...');
    
    result.outputVideoPath = join(options.outputDir, `${videoBaseName}_translated.mp4`);
    await replaceAudio(
      currentVideo,
      ttsAudioPath,
      result.outputVideoPath,
      {
        mode: options.originalAudioMode ?? 'replace',
        originalVolume: options.originalAudioVolume ?? 0,
      },
      (progress) => options.onProgress?.('replace_audio', progress)
    );
    
    result.processingSteps.push({
      step: 'replace_audio',
      success: true,
      duration: Date.now() - stepStart8,
    });

    // Step 9: Generate thumbnail
    const stepStart9 = Date.now();
    options.onProgress?.('generate_thumbnail', 0, 'Generating thumbnail...');
    
    result.thumbnailPath = join(options.outputDir, `${videoBaseName}_thumb.jpg`);
    await generateThumbnail(
      result.outputVideoPath,
      result.thumbnailPath,
      Math.min(5, result.metadata.duration / 2), // 5 seconds or mid-point
      1280
    );
    
    result.processingSteps.push({
      step: 'generate_thumbnail',
      success: true,
      duration: Date.now() - stepStart9,
    });
    options.onProgress?.('generate_thumbnail', 100, 'Thumbnail generated');

    // Success!
    result.success = true;
    options.onProgress?.('complete', 100, 'Video processing complete!');

  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
    
    options.onProgress?.('error', 0, `Processing failed: ${result.error}`);
    
    result.processingSteps.push({
      step: 'error',
      success: false,
      duration: Date.now() - startTime,
      error: result.error,
    });
  }

  return result;
}

/**
 * Process only video without audio (for preview/testing)
 */
export async function processVideoOnly(
  inputVideoPath: string,
  translatedSrtPath: string,
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    success: false,
    processingSteps: [],
  };

  try {
    if (!existsSync(inputVideoPath)) {
      throw new Error(`Input video not found: ${inputVideoPath}`);
    }
    if (!existsSync(translatedSrtPath)) {
      throw new Error(`Translated SRT not found: ${translatedSrtPath}`);
    }

    await mkdir(options.outputDir, { recursive: true });

    const videoBaseName = basename(inputVideoPath, extname(inputVideoPath));
    const tempDir = join(options.outputDir, 'temp');
    await mkdir(tempDir, { recursive: true });

    // Get metadata
    result.metadata = await getVideoMetadata(inputVideoPath);
    
    let currentVideo = inputVideoPath;

    // Detect and blur text
    const textRegions = await detectChineseTextRegions(inputVideoPath);
    if (textRegions.length > 0) {
      const blurredPath = join(tempDir, `${videoBaseName}_blurred.mp4`);
      await blurRegions(
        currentVideo,
        blurredPath,
        textRegions,
        options.blurIntensity || 20,
        (progress) => options.onProgress?.('blur_text', progress)
      );
      currentVideo = blurredPath;
    }

    // Crop if needed
    if (options.cropTo16x9) {
      const croppedPath = join(tempDir, `${videoBaseName}_cropped.mp4`);
      await cropTo169(
        currentVideo,
        croppedPath,
        (progress) => options.onProgress?.('crop', progress)
      );
      currentVideo = croppedPath;
    }

    // Burn subtitles
    const subtitledPath = join(tempDir, `${videoBaseName}_subtitled.mp4`);
    await burnSubtitles(
      currentVideo,
      subtitledPath,
      translatedSrtPath,
      options.subtitleStyle || {},
      (progress) => options.onProgress?.('burn_subtitles', progress)
    );
    currentVideo = subtitledPath;

    // Add logo
    if (options.logoPath && existsSync(options.logoPath)) {
      const logoPath = join(options.outputDir, `${videoBaseName}_preview.mp4`);
      await addLogo(
        currentVideo,
        logoPath,
        options.logoPath,
        options.logoPosition || 'top-right',
        options.logoScale || 0.15,
        20,
        (progress) => options.onProgress?.('add_logo', progress)
      );
      result.outputVideoPath = logoPath;
    } else {
      result.outputVideoPath = currentVideo;
    }

    // Generate thumbnail
    result.thumbnailPath = join(options.outputDir, `${videoBaseName}_thumb.jpg`);
    await generateThumbnail(
      result.outputVideoPath,
      result.thumbnailPath,
      Math.min(5, result.metadata.duration / 2),
      1280
    );

    result.success = true;

  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}
