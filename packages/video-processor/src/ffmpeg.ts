/**
 * FFmpeg utility functions for video processing
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface FFmpegProgress {
  frame: number;
  fps: number;
  time: string;
  bitrate: string;
  speed: string;
  progress: number; // 0-100
}

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  codec: string;
  audioCodec?: string;
  bitrate: number;
  aspectRatio: string;
}

/**
 * Extract audio from video file
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Ensure output directory exists
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', 'libmp3lame', // MP3 codec
      '-ab', '192k', // Audio bitrate
      '-ar', '44100', // Sample rate
      '-y', // Overwrite output
      outputPath,
    ];

    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      
      // Parse progress from FFmpeg output
      const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch && onProgress) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        
        // Estimate progress (we'll need duration for accurate %)
        // For now, just report that we're processing
        onProgress(50);
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg extract audio failed: ${stderr}`));
        return;
      }
      
      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Get video metadata using ffprobe
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    const process = spawn('ffprobe', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe failed: ${stderr}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
        const audioStream = data.streams.find((s: any) => s.codec_type === 'audio');

        if (!videoStream) {
          reject(new Error('No video stream found'));
          return;
        }

        const width = videoStream.width || 0;
        const height = videoStream.height || 0;
        const aspectRatio = width && height ? `${width}:${height}` : '16:9';

        resolve({
          duration: parseFloat(data.format.duration) || 0,
          width,
          height,
          fps: eval(videoStream.r_frame_rate) || 30,
          codec: videoStream.codec_name || 'unknown',
          audioCodec: audioStream?.codec_name,
          bitrate: parseInt(data.format.bit_rate) || 0,
          aspectRatio,
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err}`));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/**
 * Detect black-bar crop parameters using FFmpeg's cropdetect filter.
 * Samples the first ~10 seconds of the video (or the whole thing if
 * shorter than 10s) to find the largest non-black rectangle.
 *
 * Returns crop params like "1920:1080:0:0" or null if no crop is needed
 * (i.e. the video already has no detectable black bars).
 */
async function detectCropParams(
  inputPath: string,
  sampleSeconds = 10,
): Promise<{ crop: string; width: number; height: number; x: number; y: number } | null> {
  return new Promise((resolve, reject) => {
    // cropdetect limit=24:round=2 resets every 10 frames. We feed the
    // output to null so we don't waste I/O — we only care about stderr.
    const limit = 24; // threshold below which a pixel is considered black
    const round = 2;  // round dimensions to multiples of 2 (required by most codecs)
    const args = [
      '-ss', '0',
      '-i', inputPath,
      '-t', String(sampleSeconds),
      '-vf', `cropdetect=${limit}:${round}:0`,
      '-f', 'null',
      '-y',
      '/dev/null',
    ];
    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let lastCrop: { crop: string; width: number; height: number; x: number; y: number } | null = null;

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      // Lines look like: [Parsed_cropdetect_0 @ 0x...] x1:0 x2:1919 y1:0 y2:799 w:1920 h:800 x:0 y:0 pts:... t:...
      const matches = text.matchAll(/w:(\d+)\s+h:(\d+)\s+x:(\d+)\s+y:(\d+)/g);
      for (const m of matches) {
        const w = parseInt(m[1]);
        const h = parseInt(m[2]);
        const x = parseInt(m[3]);
        const y = parseInt(m[4]);
        if (w > 0 && h > 0) {
          lastCrop = { crop: `${w}:${h}:${x}:${y}`, width: w, height: h, x, y };
        }
      }
    });

    proc.on('close', () => {
      resolve(lastCrop);
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg cropdetect spawn failed: ${err.message}`));
    });
  });
}

/**
 * Crop video to 16:9 aspect ratio, removing black bars.
 *
 * Two-pass approach:
 *   1. cropdetect pass — scans the first 10 seconds to find the largest
 *      non-black rectangle. This handles letterbox/pillarbox black bars
 *      that CapCut-style auto-crop removes.
 *   2. crop pass — applies the detected crop (or a center-crop fallback
 *      if detection fails) AND additionally enforces a 16:9 aspect ratio
 *      so the output is YouTube-ready.
 */
export async function cropTo169(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const metadata = await getVideoMetadata(inputPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  const targetRatio = 16 / 9;
  const currentRatio = metadata.width / metadata.height;

  // If the video is already 16:9 AND has no black bars, just copy.
  if (Math.abs(currentRatio - targetRatio) < 0.01) {
    // Still run cropdetect to confirm there are no black bars.
    try {
      const detected = await detectCropParams(inputPath);
      if (!detected ||
          (detected.width === metadata.width && detected.height === metadata.height)) {
        // No black bars + already 16:9 → straight copy
        return new Promise((resolve, reject) => {
          const proc = spawn('ffmpeg', ['-i', inputPath, '-c', 'copy', '-y', outputPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) return reject(new Error(`FFmpeg copy failed: ${stderr}`));
            onProgress?.(100);
            resolve(outputPath);
          });
          proc.on('error', (err) => reject(new Error(`FFmpeg spawn failed: ${err.message}`)));
        });
      }
    } catch {
      // cropdetect failed — fall through to safe center-crop path
    }
  }

  // Pass 1: detect black-bar crop
  let detectedCrop: { width: number; height: number; x: number; y: number } | null = null;
  try {
    const detected = await detectCropParams(inputPath);
    if (detected) {
      detectedCrop = { width: detected.width, height: detected.height, x: detected.x, y: detected.y };
      // Sanity-check: detected crop must be smaller than the source,
      // otherwise we treat it as "no bars detected".
      if (detectedCrop.width >= metadata.width && detectedCrop.height >= metadata.height) {
        detectedCrop = null;
      }
    }
  } catch {
    // Detection failed — fall back to center crop
  }

  // Pass 2: compute final crop filter.
  // Start from the detected region (or full frame if nothing was detected),
  // then snap to 16:9 by trimming the longer dimension.
  const baseW = detectedCrop?.width ?? metadata.width;
  const baseH = detectedCrop?.height ?? metadata.height;
  const baseX = detectedCrop?.x ?? 0;
  const baseY = detectedCrop?.y ?? 0;
  const baseRatio = baseW / baseH;

  let cropW: number;
  let cropH: number;
  let cropX: number;
  let cropY: number;

  if (Math.abs(baseRatio - targetRatio) < 0.01) {
    // Detected region is already 16:9 — use it as-is
    cropW = baseW;
    cropH = baseH;
    cropX = baseX;
    cropY = baseY;
  } else if (baseRatio > targetRatio) {
    // Too wide — trim width to fit 16:9
    cropH = baseH;
    cropW = Math.floor(baseH * targetRatio);
    // Make sure width is even (required by most codecs)
    if (cropW % 2 !== 0) cropW -= 1;
    cropX = baseX + Math.floor((baseW - cropW) / 2);
    cropY = baseY;
  } else {
    // Too tall — trim height to fit 16:9
    cropW = baseW;
    cropH = Math.floor(baseW / targetRatio);
    if (cropH % 2 !== 0) cropH -= 1;
    cropX = baseX;
    cropY = baseY + Math.floor((baseH - cropH) / 2);
  }

  const cropFilter = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;

  // After cropping to 16:9, SCALE the result up to a standard YouTube
  // resolution so the video fills the entire player with no black bars.
  // We pick the target height based on the crop width: if the crop is
  // >= 1280px wide, target 1080p; otherwise 720p. This keeps the output
  // sharp without unnecessarily upscaling low-res sources.
  const targetWidth = cropW >= 1280 ? 1920 : 1280;
  const targetHeight = cropW >= 1280 ? 1080 : 720;
  // scale=W:H,setsar=1 ensures the pixel aspect ratio is 1:1 (square pixels)
  // so the video displays at exactly 16:9 with no letterboxing.
  const scaleFilter = `scale=${targetWidth}:${targetHeight},setsar=1`;

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vf', `${cropFilter},${scaleFilter}`,
      // Re-encode with reasonable quality — copy can't be used because
      // we're filtering the frame data.
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'copy',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          onProgress(progress);
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg crop failed: ${stderr}`));
        return;
      }
      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Detect Chinese text regions using Tesseract OCR.
 *
 * Extracts a frame at ~10% into the video, runs OCR with chi_sim language
 * data, and returns the bounding boxes of detected text. This is much more
 * accurate than guessing a fixed subtitle band, because Chinese animations
 * position subtitles anywhere from 40% to 85% of the frame height.
 *
 * Falls back to the bottom 30% band if:
 *   - Tesseract or chi_sim language data is not installed
 *   - No text is detected (e.g., the sample frame has no subtitles)
 *   - The OCR script itself errors out
 */
export async function detectChineseTextRegions(
  videoPath: string
): Promise<Array<{ x: number; y: number; width: number; height: number; text: string }>> {
  const metadata = await getVideoMetadata(videoPath);

  // Fallback: bottom 30% band
  const fallback = () => {
    const bandHeight = Math.floor(metadata.height * 0.30);
    return [{
      x: 0,
      y: metadata.height - bandHeight,
      width: metadata.width,
      height: bandHeight,
      text: 'subtitle_region_fallback',
    }];
  };

  try {
    const { spawn } = await import('node:child_process');
    const { writeFile, unlink, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    // Extract frames at MULTIPLE timestamps to catch subtitles that appear
    // at different points in the video. Chinese animations often have a
    // title card for the first few seconds with no subtitles, so sampling
    // only at 5s would miss the actual subtitle region.
    const sampleTimes = [
      metadata.duration * 0.05,  // 5%
      metadata.duration * 0.12,  // 12%
      metadata.duration * 0.20,  // 20%
      metadata.duration * 0.30,  // 30%
      metadata.duration * 0.40,  // 40%
      metadata.duration * 0.50,  // 50%
      metadata.duration * 0.60,  // 60%
      metadata.duration * 0.70,  // 70%
      metadata.duration * 0.80,  // 80%
      metadata.duration * 0.90,  // 90%
    ].filter((t) => t > 0.5 && t < metadata.duration - 0.5).map((t) => Math.round(t));

    const tempDir = join(tmpdir(), 'sleiz-ocr');
    await mkdir(tempDir, { recursive: true });

    // Extract frames and run OCR on each, collecting all detected regions
    const allRegions: Array<{ x: number; y: number; width: number; height: number; text: string }> = [];

    for (const sampleTime of sampleTimes) {
      const framePath = join(tempDir, `frame_${Date.now()}_${sampleTime}.png`);

      // Extract frame
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('ffmpeg', [
            '-ss', String(sampleTime),
            '-i', videoPath,
            '-vframes', '1',
            '-y',
            framePath,
          ], { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          proc.on('close', (code) => {
            if (code !== 0) reject(new Error(`FFmpeg frame extract failed: ${stderr}`));
            else resolve();
          });
          proc.on('error', reject);
        });
      } catch {
        continue; // skip this timestamp if frame extraction fails
      }

      // Find the detect_text.py script
      const { fileURLToPath } = await import('node:url');
      const currentDir = typeof __dirname !== 'undefined'
        ? __dirname
        : fileURLToPath(new URL('.', import.meta.url));
      const scriptPath = join(currentDir, '..', 'scripts', 'detect_text.py');
      const scriptPathAlt = join(process.cwd(), 'packages', 'video-processor', 'scripts', 'detect_text.py');
      const actualScriptPath = existsSync(scriptPath) ? scriptPath : (existsSync(scriptPathAlt) ? scriptPathAlt : scriptPath);

      // Find tessdata with chi_sim
      const tessdataCandidates = [
        process.env.TESSDATA_PREFIX,
        '/usr/share/tesseract-ocr/5/tessdata',
        '/usr/share/tesseract-ocr/4.00/tessdata',
        '/usr/share/tessdata',
        '/tmp',
      ].filter(Boolean);
      const env = { ...process.env };
      for (const candidate of tessdataCandidates) {
        if (existsSync(join(candidate, 'chi_sim.traineddata'))) {
          env.TESSDATA_PREFIX = candidate;
          break;
        }
      }

      // Run OCR
      try {
        const ocrResult = await new Promise<string>((resolve, reject) => {
          const args = [actualScriptPath, framePath, '--lang', 'chi_sim', '--padding', '6', '--min-conf', '40'];
          if (env.TESSDATA_PREFIX) args.push('--tessdata-prefix', env.TESSDATA_PREFIX);
          // On Windows, `python3` doesn't exist — only `python` (or `py`).
          // Try python3 first (Linux/Mac), then python (Windows), then py.
          const pythonBinaries = ['python3', 'python', 'py'];
          const trySpawn = (binIdx: number) => {
            if (binIdx >= pythonBinaries.length) {
              reject(new Error('No Python binary found (tried python3, python, py). Install Python 3 and add it to PATH.'));
              return;
            }
            const bin = pythonBinaries[binIdx];
            const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
            let stdout = '', stderr = '';
            let settled = false;
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            // ENOENT (binary not found) fires as 'error' before 'close'
            proc.on('error', (err: any) => {
              if (settled) return;
              if (err.code === 'ENOENT') {
                console.warn(`[OCR] '${bin}' not found, trying next...`);
                trySpawn(binIdx + 1);
              } else {
                settled = true;
                reject(err);
              }
            });
            proc.on('close', (code) => {
              if (settled) return;
              settled = true;
              if (code !== 0) reject(new Error(`OCR script failed (code ${code}): ${stderr}`));
              else resolve(stdout.trim());
            });
          };
          trySpawn(0);
        });

        const regions = JSON.parse(ocrResult);
        if (Array.isArray(regions)) {
          for (const r of regions) {
            allRegions.push({ x: r.x, y: r.y, width: r.width, height: r.height, text: r.text || 'chinese_text' });
          }
        }
      } catch {
        // OCR failed for this frame — try next timestamp
      }

      // Clean up temp frame
      try { await unlink(framePath); } catch { /* ignore */ }
    } // end for each sampleTime

    // Merge boxes on the SAME text line (similar y coordinate) into tight
    // horizontal strips, but keep different lines separate. This produces
    // tight regions that blur transparently (unlike large merged boxes
    // which look milky/opaque).
    if (allRegions.length > 0) {
      return mergeSameLineRegions(allRegions);
    }

    // No text detected at any timestamp — fall back
    return fallback();
  } catch (err) {
    console.warn('[detectChineseTextRegions] OCR failed, using fallback:', err instanceof Error ? err.message : err);
    return fallback();
  }
}

/**
 * Merge overlapping or nearby text regions into larger bounding boxes.
 * Used to combine OCR results from multiple sample frames.
 */
function mergeRegions(
  regions: Array<{ x: number; y: number; width: number; height: number; text: string }>,
  mergeDistance = 80,
): Array<{ x: number; y: number; width: number; height: number; text: string }> {
  if (regions.length <= 1) return regions;

  const merged: Array<{ x: number; y: number; width: number; height: number; text: string }> = [];
  for (const r of regions) {
    const r2x = r.x + r.width;
    const r2y = r.y + r.height;
    let absorbed = false;
    for (const m of merged) {
      const m2x = m.x + m.width;
      const m2y = m.y + m.height;
      // Check overlap or proximity
      if (!(r2x + mergeDistance < m.x || r.x > m2x + mergeDistance ||
            r2y + mergeDistance < m.y || r.y > m2y + mergeDistance)) {
        m.x = Math.min(m.x, r.x);
        m.y = Math.min(m.y, r.y);
        m.width = Math.max(m2x, r2x) - m.x;
        m.height = Math.max(m2y, r2y) - m.y;
        m.text = m.text + ' ' + r.text;
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push({ ...r });
  }
  return merged;
}

/**
 * Remove duplicate regions that cover the same area (from multiple OCR
 * samples of similar frames). Keeps the tightest box for each cluster.
 * Unlike mergeRegions, this does NOT enlarge boxes — it only removes
 * near-duplicates, preserving the tight per-text-blob regions that blur
 * transparently.
 */
function deduplicateRegions(
  regions: Array<{ x: number; y: number; width: number; height: number; text: string }>,
  tolerance = 30,
): Array<{ x: number; y: number; width: number; height: number; text: string }> {
  if (regions.length <= 1) return regions;

  const result: Array<{ x: number; y: number; width: number; height: number; text: string }> = [];
  for (const r of regions) {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    let isDup = false;
    for (const kept of result) {
      const kcx = kept.x + kept.width / 2;
      const kcy = kept.y + kept.height / 2;
      // If centers are within tolerance, consider it a duplicate
      if (Math.abs(cx - kcx) < tolerance && Math.abs(cy - kcy) < tolerance) {
        isDup = true;
        break;
      }
    }
    if (!isDup) result.push({ ...r });
  }
  return result;
}

/**
 * Merge OCR boxes that are on the SAME text line (overlapping or nearby
 * y-coordinates) into tight horizontal strips. Boxes on DIFFERENT lines
 * stay separate. This produces tight per-line blur regions that:
 *   - Cover all text on that line (no gaps)
 *   - Are only as tall as the text (not a wide band)
 *   - Blur transparently because the region is tight
 *
 * yTolerance: max vertical gap between boxes to be considered same line (default 25px)
 * xGap: max horizontal gap between boxes on same line to merge (default 60px)
 */
function mergeSameLineRegions(
  regions: Array<{ x: number; y: number; width: number; height: number; text: string }>,
  yTolerance = 25,
  xGap = 60,
): Array<{ x: number; y: number; width: number; height: number; text: string }> {
  if (regions.length <= 1) return regions;

  // Sort by y (top edge), then x (left edge)
  const sorted = [...regions].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: Array<Array<typeof regions[0]>> = [];
  for (const r of sorted) {
    // Find an existing line whose y-range overlaps with this box's y-range
    let placed = false;
    for (const line of lines) {
      const lineY = line[0].y;
      const lineH = line[0].height;
      const lineY2 = lineY + lineH;
      const rY2 = r.y + r.height;
      // Check if y-ranges overlap within tolerance
      if (r.y <= lineY2 + yTolerance && rY2 >= lineY - yTolerance) {
        line.push(r);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([r]);
  }

  // For each line, merge all boxes into one tight horizontal strip
  const result: Array<{ x: number; y: number; width: number; height: number; text: string }> = [];
  for (const line of lines) {
    const minX = Math.min(...line.map((b) => b.x));
    const minY = Math.min(...line.map((b) => b.y));
    const maxX = Math.max(...line.map((b) => b.x + b.width));
    const maxY = Math.max(...line.map((b) => b.y + b.height));
    result.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      text: line.map((b) => b.text).join(' '),
    });
  }
  return result;
}

/**
 * Add blur effect to specified regions in video
 */
export async function blurRegions(
  inputPath: string,
  outputPath: string,
  regions: Array<{ x: number; y: number; width: number; height: number }>,
  blurIntensity: number = 20,
  onProgress?: (progress: number) => void
): Promise<string> {
  const metadata = await getVideoMetadata(inputPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  // Build blur filter for each region
  const filters: string[] = [];
  
  for (const region of regions) {
    // Blur filter: crop region, blur it, overlay back
    filters.push(
      `[0:v]crop=${region.width}:${region.height}:${region.x}:${region.y},` +
      `boxblur=${blurIntensity}:${blurIntensity}[blurred${filters.length}];` +
      `[0:v][blurred${filters.length}]overlay=${region.x}:${region.y}`
    );
  }

  const filterComplex = filters.join(';') || 'copy';

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-filter_complex', filterComplex,
      '-c:a', 'copy', // Copy audio
      '-y',
      outputPath,
    ];

    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      
      if (onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          onProgress(progress);
        }
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg blur failed: ${stderr}`));
        return;
      }
      
      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Add logo watermark to video
 */
export async function addLogo(
  inputPath: string,
  outputPath: string,
  logoPath: string,
  position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' = 'top-right',
  scale: number = 0.15, // Logo size as percentage of video width
  margin: number = 20, // Margin from edges
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!existsSync(logoPath)) {
    throw new Error(`Logo file not found: ${logoPath}`);
  }

  const metadata = await getVideoMetadata(inputPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  // Calculate logo size
  const logoWidth = Math.floor(metadata.width * scale);

  // Calculate position
  let overlayX: string;
  let overlayY: string;

  switch (position) {
    case 'top-right':
      overlayX = `W-w-${margin}`;
      overlayY = `${margin}`;
      break;
    case 'top-left':
      overlayX = `${margin}`;
      overlayY = `${margin}`;
      break;
    case 'bottom-right':
      overlayX = `W-w-${margin}`;
      overlayY = `H-h-${margin}`;
      break;
    case 'bottom-left':
      overlayX = `${margin}`;
      overlayY = `H-h-${margin}`;
      break;
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-i', logoPath,
      '-filter_complex',
      `[1:v]scale=${logoWidth}:-1[logo];[0:v][logo]overlay=${overlayX}:${overlayY}`,
      '-c:a', 'copy', // Copy audio
      '-y',
      outputPath,
    ];

    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      
      if (onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          onProgress(progress);
        }
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg add logo failed: ${stderr}`));
        return;
      }
      
      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Blur the Chinese subtitle region AND burn Vietnamese subtitles on top,
 * all in a single FFmpeg pass. This is much faster than running blurRegions
 * and burnSubtitles separately (one re-encode instead of two).
 *
 * Pipeline:
 *   1. Extract the bottom subtitle band from the source frame
 *   2. Apply strong boxblur to make Chinese text unreadable
 *   3. Overlay the blurred band back onto the original frame
 *   4. Burn the Vietnamese SRT on top with readable styling
 *
 * The Vietnamese subs are positioned in the same bottom region so they
 * visually replace the original Chinese text.
 */
export async function blurAndBurnSubtitles(
  inputPath: string,
  outputPath: string,
  srtPath: string,
  options: {
    /** Specific regions to blur (from OCR). If provided, these are used
     *  instead of the bottom band. Each region: {x, y, width, height}. */
    blurRegions?: Array<{ x: number; y: number; width: number; height: number }>;
    /** Height of the fallback blur band as a fraction of video height. */
    subtitleBandRatio?: number;
    /** Boxblur strength (higher = more blurred). Default 40. */
    blurStrength?: number;
    /** Font family for Vietnamese subs. Must be installed on the system. */
    fontName?: string;
    /** Font size in pixels. If omitted, auto-scaled to video height. */
    fontSize?: number;
    /** Vertical margin from the bottom for the subtitle text. */
    marginV?: number;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<string> {
  if (!existsSync(inputPath)) {
    throw new Error(`Video file not found: ${inputPath}`);
  }
  if (!existsSync(srtPath)) {
    throw new Error(`SRT file not found: ${srtPath}`);
  }

  const metadata = await getVideoMetadata(inputPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  // --- Determine blur regions ---
  // If OCR-detected regions are provided, use them. Otherwise fall back
  // to the bottom 30% band.
  const regions = options.blurRegions && options.blurRegions.length > 0
    ? options.blurRegions
    : (() => {
        const bandHeight = Math.floor(metadata.height * (options.subtitleBandRatio ?? 0.30));
        return [{ x: 0, y: metadata.height - bandHeight, width: metadata.width, height: bandHeight }];
      })();

  // --- Blur strength ---
  // Default 15 — moderate gaussian blur that obscures text while keeping
  // the video content visible through the frosted-glass effect.
  // sigma 8-12 = too light (text still readable)
  // sigma 15-20 = sweet spot (text obscured, video visible)
  // sigma 25+ = too milky/opaque
  const blurStrength = options.blurStrength ?? 8;

  // --- Subtitle styling ---
  const fontSize = options.fontSize ?? Math.max(16, Math.floor(metadata.height / 30));
  const fontName = options.fontName || 'Arial';
  const marginV = options.marginV ?? Math.floor(metadata.height * 0.04);

  // Escape SRT path for FFmpeg subtitles filter (Windows drive colons)
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  // --- Build the combined filter_complex ---
  // For each OCR-detected region:
  //   1. Crop the region from the source
  //   2. Apply strong boxblur
  //   3. Draw a black rectangle on top (opacity 0.85) to fully hide text
  //   4. Overlay the result back onto the source
  // After all regions are processed:
  //   5. Burn Vietnamese SRT at the bottom of the frame
  //
  // This approach is more efficient than it looks: FFmpeg's filter_complex
  // is smart about only decoding the source once, and the crop/overlay
  // chain operates on in-memory frames without intermediate files.

  const filterParts: string[] = [];
  let lastLabel = '0:v';

  // Blur strength: sigma directly controls gaussian blur radius.
  // sigma=8-12 = light frosted glass (transparent, video visible through blur)
  // sigma=20+ = heavy blur (more opaque/milky, less see-through)
  const blurSigma = blurStrength;

  if (regions.length === 1 && regions[0].x === 0 && regions[0].width === metadata.width) {
    // Single full-width region — simpler filter (no need to chain multiple overlays)
    const r = regions[0];
    const safeY = Math.round(r.y / 2) * 2;
    const safeH = Math.round(r.height / 2) * 2;
    filterParts.push(
      // Crop the region, apply strong gaussian blur, then overlay back.
      // NO drawbox — the blur itself is the obscuring mechanism, keeping
      // the video content visible through the frosted-glass effect.
      `[0:v]crop=${metadata.width}:${safeH}:0:${safeY},gblur=sigma=${blurSigma}[blurred0]`,
      `[0:v][blurred0]overlay=0:${safeY}[bg]`,
    );
    lastLabel = 'bg';
  } else {
    // Multiple regions or partial-width regions — chain overlays
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const safeX = Math.round(r.x / 2) * 2;
      const safeY = Math.round(r.y / 2) * 2;
      const safeW = Math.round(r.width / 2) * 2;
      const safeH = Math.round(r.height / 2) * 2;
      const inputLabel = i === 0 ? '0:v' : `bg${i - 1}`;
      const outputLabel = `bg${i}`;
      filterParts.push(
        `[0:v]crop=${safeW}:${safeH}:${safeX}:${safeY},gblur=sigma=${blurSigma}[blurred${i}]`,
        `[${inputLabel}][blurred${i}]overlay=${safeX}:${safeY}[${outputLabel}]`,
      );
      lastLabel = outputLabel;
    }
  }

  // Final step: burn Vietnamese subtitles on top
  filterParts.push(
    `[${lastLabel}]subtitles=${escapedSrtPath}:force_style='FontName=${fontName},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,MarginV=${marginV},Alignment=2'[out]`,
  );

  const filterComplex = filterParts.join(';');

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-c:a', 'copy',
      '-y',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          options.onProgress(progress);
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg blur+burn failed: ${stderr}`));
        return;
      }
      options.onProgress?.(100);
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Burn subtitles onto video with styling
 */
export async function burnSubtitles(
  inputPath: string,
  outputPath: string,
  srtPath: string,
  options: {
    fontName?: string;
    fontSize?: number;
    primaryColor?: string; // &HAABBGGRR format
    outlineColor?: string;
    borderStyle?: number;
    outline?: number;
    shadow?: number;
    marginV?: number;
  } = {},
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!existsSync(srtPath)) {
    throw new Error(`SRT file not found: ${srtPath}`);
  }

  const metadata = await getVideoMetadata(inputPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  // Default subtitle styling
  const style = {
    fontName: options.fontName || 'Arial',
    fontSize: options.fontSize || 24,
    primaryColor: options.primaryColor || '&H00FFFFFF', // White
    outlineColor: options.outlineColor || '&H00000000', // Black
    borderStyle: options.borderStyle || 1,
    outline: options.outline || 2,
    shadow: options.shadow || 0,
    marginV: options.marginV || 25,
  };

  // Escape path for Windows
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vf',
      `subtitles=${escapedSrtPath}:force_style='FontName=${style.fontName},FontSize=${style.fontSize},PrimaryColour=${style.primaryColor},OutlineColour=${style.outlineColor},BorderStyle=${style.borderStyle},Outline=${style.outline},Shadow=${style.shadow},MarginV=${style.marginV}'`,
      '-c:a', 'copy',
      '-y',
      outputPath,
    ];

    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      
      if (onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          onProgress(progress);
        }
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg burn subtitles failed: ${stderr}`));
        return;
      }
      
      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Replace audio track in video.
 *
 * Audio mixing modes:
 *   - 'replace' (default): discard original audio entirely, use only the new track
 *   - 'mix': keep original audio at `originalVolume` (0.0–1.0) alongside the
 *     new TTS track at full volume. Useful when the user wants background
 *     music / ambient sound from the original to remain audible.
 */
export async function replaceAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  optionsOrProgress?:
    | ((progress: number) => void)
    | { mode?: 'replace' | 'mix'; originalVolume?: number; onProgress?: (progress: number) => void },
): Promise<string> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Backwards-compat: the old signature was (video, audio, output, onProgress?)
  // Support both the new options object and the old callback form.
  const options = typeof optionsOrProgress === 'function'
    ? { mode: 'replace' as const, originalVolume: 0, onProgress: optionsOrProgress }
    : (optionsOrProgress ?? {});
  const mode: 'replace' | 'mix' = options.mode === 'mix' ? 'mix' : 'replace';
  const originalVolume = Math.max(0, Math.min(1.0, options.originalVolume ?? 0));
  const onProgress = options.onProgress;

  const metadata = await getVideoMetadata(videoPath);
  const outputDir = dirname(outputPath);
  await mkdir(outputPath, { recursive: true });

  let args: string[];
  if (mode === 'mix') {
    // Mix original (at originalVolume) + TTS (at full volume) into a stereo track.
    //   [0:a] -> lowered volume
    //   [1:a] -> TTS as-is
    //   amix inputs=2 → averaged together, then we normalize the level back
    //   with volume=2.0 to compensate for amix's 1/N attenuation.
    args = [
      '-i', videoPath,
      '-i', audioPath,
      '-filter_complex',
      `[0:a]volume=${originalVolume}[orig];[1:a]volume=1.0[tts];` +
      `[orig][tts]amix=inputs=2:duration=first:dropout_transition=0,` +
      `volume=2.0[aout]`,
      '-map', '0:v:0',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath,
    ];
  } else {
    // Replace: drop original audio, use only TTS
    args = [
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-y',
      outputPath,
    ];
  }

  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();

      if (onProgress) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;
          const progress = Math.min(100, (currentTime / metadata.duration) * 100);
          onProgress(progress);
        }
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg replace audio failed: ${stderr}`));
        return;
      }

      if (onProgress) onProgress(100);
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Generate thumbnail from video at specific timestamp
 */
export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp: number = 0, // seconds
  width: number = 1280
): Promise<string> {
  const outputDir = dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      '-ss', timestamp.toString(),
      '-i', videoPath,
      '-vf', `scale=${width}:-1`,
      '-vframes', '1',
      '-y',
      outputPath,
    ];

    const process = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg thumbnail failed: ${stderr}`));
        return;
      }
      
      resolve(outputPath);
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}
