/**
 * TikTok Text-to-Speech (TTS) API integration
 * 
 * Converts SRT subtitles to Vietnamese audio using TikTok's TTS voices.
 * Requires a valid TikTok session ID from tiktok.com cookies.
 * 
 * Reference: https://github.com/Steve0929/tiktok-tts
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import type { SubtitleCue } from '@sleiz/shared';

export interface TikTokVoice {
  code: string;
  name: string;
  language: string;
  gender?: 'male' | 'female';
}

export const VIETNAMESE_VOICES: TikTokVoice[] = [
  { code: 'BV074_streaming', name: 'Female Vietnamese', language: 'vi', gender: 'female' },
  { code: 'BV075_streaming', name: 'Male Vietnamese', language: 'vi', gender: 'male' },
];

export const ALL_VOICES: TikTokVoice[] = [
  ...VIETNAMESE_VOICES,
  { code: 'en_us_001', name: 'Female English US', language: 'en', gender: 'female' },
  { code: 'en_us_002', name: 'Jessie', language: 'en', gender: 'female' },
  { code: 'en_male_narration', name: 'Story Teller', language: 'en', gender: 'male' },
  { code: 'en_uk_001', name: 'Narrator', language: 'en', gender: 'male' },
  { code: 'jp_001', name: 'Japanese Female 1', language: 'ja', gender: 'female' },
  { code: 'jp_006', name: 'Japanese Male', language: 'ja', gender: 'male' },
  { code: 'kr_002', name: 'Korean Male 1', language: 'ko', gender: 'male' },
  { code: 'kr_003', name: 'Korean Female', language: 'ko', gender: 'female' },
];

export interface TTSConfig {
  sessionId: string;
  voice: string;
  baseUrl?: string;
}

export interface TTSResult {
  audioPath: string;
  duration: number; // milliseconds
  text: string;
  success: boolean;
  error?: string;
}

export interface SRTToAudioOptions {
  voice?: string;
  outputDir: string;
  outputFilename?: string;
  maxCharsPerRequest?: number; // TikTok has char limits
  /** Playback speed multiplier for the generated speech (1.0 = normal).
   *  Range 0.5–2.0. Applied via FFmpeg atempo filter during merge. */
  speed?: number;
  /** Output volume multiplier for the generated speech (1.0 = normal).
   *  Range 0.0–3.0. Applied via FFmpeg volume filter during merge. */
  volume?: number;
  onProgress?: (current: number, total: number, message?: string) => void;
}

/**
 * TikTok TTS API client
 */
export class TikTokTTSClient {
  private sessionId: string;
  private baseUrl: string;
  private userAgent: string;

  constructor(config: TTSConfig) {
    if (!config.sessionId) {
      throw new Error('TikTok session ID is required. Get it from tiktok.com cookies.');
    }
    
    this.sessionId = config.sessionId;
    this.baseUrl = config.baseUrl || 'https://api16-normal-c-useast1a.tiktokv.com/media/api/text/speech/invoke';
    this.userAgent = 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)';
  }

  /**
   * Generate speech for a single text segment
   */
  async generateSpeech(text: string, voice: string = 'BV074_streaming'): Promise<Buffer> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // TikTok TTS has a character limit per request (usually ~300 chars)
    if (text.length > 300) {
      throw new Error(`Text too long (${text.length} chars). Split into chunks of 300 chars or less.`);
    }

    const params = new URLSearchParams({
      text_speaker: voice,
      req_text: text,
      speaker_map_type: '0',
      aid: '1233',
    });

    const url = `${this.baseUrl}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': `sessionid=${this.sessionId}`,
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    });

    if (!response.ok) {
      throw new Error(`TikTok TTS API error: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      status_code: number;
      status_msg: string;
      data?: {
        v_str?: string; // base64 encoded audio
        duration?: number;
        speaker?: string;
      };
    };

    if (data.status_code !== 0) {
      throw new Error(`TikTok TTS failed: ${data.status_msg || 'Unknown error'}`);
    }

    if (!data.data?.v_str) {
      throw new Error('TikTok TTS returned no audio data');
    }

    // Decode base64 audio
    const audioBase64 = data.data.v_str;
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    return audioBuffer;
  }

  /**
   * Convert SRT subtitles to audio file
   * Combines all subtitle cues into a single audio track with proper timing
   */
  async srtToAudio(
    cues: SubtitleCue[],
    options: SRTToAudioOptions
  ): Promise<TTSResult> {
    const startTime = Date.now();
    
    try {
      // Ensure output directory exists
      await mkdir(options.outputDir, { recursive: true });

      const voice = options.voice || 'BV074_streaming';
      const outputFilename = options.outputFilename || `tts_${Date.now()}.mp3`;
      const outputPath = join(options.outputDir, outputFilename);
      const tempDir = join(options.outputDir, 'temp_tts');
      await mkdir(tempDir, { recursive: true });

      // Generate audio for each cue
      const audioSegments: Array<{
        audioPath: string;
        startMs: number;
        endMs: number;
        text: string;
      }> = [];

      const totalCues = cues.length;
      options.onProgress?.(0, totalCues, 'Starting TTS generation...');

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const text = cue.textTranslated || cue.text || '';
        
        if (!text.trim()) {
          options.onProgress?.(i + 1, totalCues, `Skipping empty cue ${i + 1}`);
          continue;
        }

        options.onProgress?.(i + 1, totalCues, `Generating audio for cue ${i + 1}/${totalCues}`);

        // Split long text into chunks if needed
        const chunks = this.splitTextIntoChunks(text, options.maxCharsPerRequest || 290);
        const chunkAudios: Buffer[] = [];

        for (const chunk of chunks) {
          try {
            const audioBuffer = await this.generateSpeech(chunk, voice);
            chunkAudios.push(audioBuffer);
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.error(`Failed to generate TTS for chunk: ${chunk.substring(0, 50)}...`, error);
            throw error;
          }
        }

        // Merge chunk audios if multiple chunks
        let finalAudio: Buffer;
        if (chunkAudios.length === 1) {
          finalAudio = chunkAudios[0];
        } else {
          // For multiple chunks, we need to concatenate them
          // This is a simple concatenation; for better quality, use FFmpeg to properly merge
          finalAudio = Buffer.concat(chunkAudios);
        }

        // Save individual audio segment
        const segmentPath = join(tempDir, `segment_${i.toString().padStart(4, '0')}.mp3`);
        await writeFile(segmentPath, finalAudio);

        audioSegments.push({
          audioPath: segmentPath,
          startMs: cue.startMs,
          endMs: cue.endMs,
          text,
        });
      }

      options.onProgress?.(totalCues, totalCues, 'Merging audio segments...');

      // Merge all segments with proper timing using FFmpeg,
      // applying optional speed and volume adjustments in the same pass.
      await this.mergeAudioSegments(audioSegments, outputPath, {
        speed: options.speed,
        volume: options.volume,
      });

      // Clean up temp directory
      try {
        const { rm } = await import('node:fs/promises');
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      const duration = Date.now() - startTime;
      options.onProgress?.(totalCues, totalCues, 'TTS generation complete!');

      return {
        audioPath: outputPath,
        duration,
        text: cues.map(c => c.textTranslated || c.text || '').join(' '),
        success: true,
      };

    } catch (error) {
      return {
        audioPath: '',
        duration: Date.now() - startTime,
        text: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Split text into chunks that fit TikTok's character limit
   */
  private splitTextIntoChunks(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) {
      return [text];
    }

    const chunks: string[] = [];
    const sentences = text.split(/([.!?。！？]+\s*)/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= maxChars) {
        currentChunk += sentence;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        
        // If a single sentence is too long, split by words
        if (sentence.length > maxChars) {
          const words = sentence.split(/\s+/);
          let wordChunk = '';
          
          for (const word of words) {
            if ((wordChunk + ' ' + word).length <= maxChars) {
              wordChunk += (wordChunk ? ' ' : '') + word;
            } else {
              if (wordChunk) {
                chunks.push(wordChunk.trim());
              }
              wordChunk = word;
            }
          }
          
          currentChunk = wordChunk;
        } else {
          currentChunk = sentence;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Merge audio segments with proper timing using FFmpeg.
   * Optionally applies playback speed (atempo) and volume adjustments
   * in the same filter chain so we only encode once.
   */
  private async mergeAudioSegments(
    segments: Array<{ audioPath: string; startMs: number; endMs: number; text: string }>,
    outputPath: string,
    options: { speed?: number; volume?: number } = {}
  ): Promise<void> {
    if (segments.length === 0) {
      throw new Error('No audio segments to merge');
    }

    // Create FFmpeg filter complex for concatenation with silence padding
    const { spawn } = await import('node:child_process');

    const speed = options.speed ?? 1.0;
    const volume = options.volume ?? 1.0;
    const needAdjust = (speed > 0 && Math.abs(speed - 1.0) > 0.001) ||
                       (volume > 0 && Math.abs(volume - 1.0) > 0.001);

    // Simple approach: concatenate all segments
    // For more accurate timing, we'd need to add silence between segments
    const inputArgs: string[] = [];
    const filterParts: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      inputArgs.push('-i', segments[i].audioPath);
      filterParts.push(`[${i}:a]`);
    }

    // Build filter chain:
    //   [0:a][1:a]...concat[n]:a
    //   then optionally [n]atempo=speed,volume=vol[out]
    // atempo only supports 0.5–2.0 per filter; for extreme values we'd
    // chain multiple atempo filters, but 0.5–2.0 covers all practical use.
    let filterComplex: string;
    if (needAdjust) {
      const parts: string[] = [];
      // Clamp speed into FFmpeg's supported range (0.5–100.0, but
      // quality degrades outside 0.5–2.0). We chain two atempo filters
      // if speed is out of single-filter range.
      const atempoChain = buildAtempoChain(speed);
      const volumeFilter = `volume=${Math.max(0, Math.min(3, volume))}`;
      filterComplex = `${filterParts.join('')}concat=n=${segments.length}:v=0:a=1[concat];[concat]${atempoChain},${volumeFilter}[out]`;
      void parts;
    } else {
      filterComplex = `${filterParts.join('')}concat=n=${segments.length}:v=0:a=1[out]`;
    }

    const args = [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-y',
      outputPath,
    ];

    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg merge failed: ${stderr}`));
          return;
        }
        resolve();
      });

      process.on('error', (err) => {
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
      });
    });
  }

  /**
   * Test TikTok session ID validity
   */
  async testSessionId(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.generateSpeech('test', 'BV074_streaming');
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Build a chain of FFmpeg `atempo` filters that achieves the requested
 * playback speed. FFmpeg's atempo filter only supports 0.5–2.0 per
 * instance, so for speeds outside that range we chain multiple filters
 * (e.g. speed=4 → atempo=2.0,atempo=2.0).
 *
 * Examples:
 *   1.0 → ""
 *   1.5 → "atempo=1.5"
 *   0.5 → "atempo=0.5"
 *   3.0 → "atempo=2.0,atempo=1.5"
 *   0.25 → "atempo=0.5,atempo=0.5"
 */
export function buildAtempoChain(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) return '';
  if (Math.abs(speed - 1.0) < 0.001) return '';

  const chain: number[] = [];
  let remaining = speed;

  // Speed up: factor out 2.0 chunks
  while (remaining > 2.0) {
    chain.push(2.0);
    remaining /= 2.0;
  }
  // Slow down: factor out 0.5 chunks
  while (remaining < 0.5) {
    chain.push(0.5);
    remaining /= 0.5;
  }
  // Final factor (within 0.5–2.0)
  if (Math.abs(remaining - 1.0) > 0.001) {
    chain.push(remaining);
  }

  if (chain.length === 0) return '';
  return chain.map((s) => `atempo=${s.toFixed(4)}`).join(',');
}

/**
 * Helper function to create TTS client from settings
 */
export function createTTSClient(sessionId: string, baseUrl?: string): TikTokTTSClient {
  return new TikTokTTSClient({
    sessionId,
    voice: 'BV074_streaming',
    baseUrl,
  });
}

/**
 * Get available Vietnamese voices
 */
export function getVietnameseVoices(): TikTokVoice[] {
  return VIETNAMESE_VOICES;
}

/**
 * Get all available voices
 */
export function getAllVoices(): TikTokVoice[] {
  return ALL_VOICES;
}
