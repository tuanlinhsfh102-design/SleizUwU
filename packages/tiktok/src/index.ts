/**
 * @sleiz/tiktok - TikTok video metadata + downloader + TTS.
 *
 * Strategy:
 *   1. Try the public TikWM API mirror (https://www.tikwm.com/api/) which
 *      proxies TikTok's mobile feed endpoint and returns JSON with a
 *      direct video URL. No auth required.
 *   2. Fallback to yt-dlp CLI (must be installed separately) which handles
 *      bot-detection better via its dedicated extractor.
 *   3. TTS: Use TikTok's internal TTS API to convert text/SRT to audio.
 *
 * References:
 *   - TikWM: https://www.tikwm.com/ (free public mirror, no official docs)
 *   - yt-dlp TikTok extractor: https://github.com/yt-dlp/yt-dlp
 *   - TikTok TTS: https://github.com/Steve0929/tiktok-tts
 */

export * from './tts.js';

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TiktokVideoInfo {
  id: string;
  url: string;
  author: string;
  authorId: string;
  authorAvatar?: string;
  title: string;
  description: string;
  cover: string;
  dynamicCover?: string;
  originCover?: string;
  duration: number; // seconds
  playUrl: string; // direct mp4 (watermarked or not depending on source)
  playUrlNoWatermark?: string;
  downloadUrl?: string;
  musicUrl?: string;
  musicTitle?: string;
  musicAuthor?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  downloadCount?: number;
  createdAt?: number;
  region?: string;
}

export interface TiktokDownloadResult {
  filePath: string;
  fileSize: number;
  durationMs: number;
  source: 'tikwm' | 'ytdlp' | 'direct';
  mimeType: string;
}

/**
 * Progress callback for streaming downloads.
 * - `receivedBytes` is the running total of bytes written to disk so far
 * - `totalBytes` is the total size in bytes (or 0 if Content-Length is unknown)
 * - `percent` is 0..100 (clamped; when totalBytes is 0, percent stays 0)
 * - `speedBps` is the moving average bytes/sec since the download started
 */
export interface DownloadProgressEvent {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  speedBps: number;
}
export type DownloadProgressCallback = (e: DownloadProgressEvent) => void;

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------
export interface ParsedTiktokUrl {
  kind: 'video' | 'user' | 'short';
  id?: string;
  username?: string;
  url: string;
}

export function parseTiktokUrl(input: string): ParsedTiktokUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // https://www.tiktok.com/@username/video/1234567890
  const videoMatch = trimmed.match(/tiktok\.com\/@([\w.-]+)\/video\/(\d+)/);
  if (videoMatch) {
    return { kind: 'video', id: videoMatch[2], username: videoMatch[1], url: trimmed };
  }
  // https://www.tiktok.com/@username
  const userMatch = trimmed.match(/tiktok\.com\/@([\w.-]+)/);
  if (userMatch) {
    return { kind: 'user', username: userMatch[1], url: trimmed };
  }
  // https://vm.tiktok.com/Z123abCD/ or https://vt.tiktok.com/Z123abCD/
  const shortMatch = trimmed.match(/(vm|vt)\.tiktok\.com\/([\w-]+)/);
  if (shortMatch) {
    return { kind: 'short', url: trimmed };
  }
  // Direct video id (digits only, 18-19 chars)
  if (/^\d{17,21}$/.test(trimmed)) {
    return { kind: 'video', id: trimmed, url: `https://www.tiktok.com/@/video/${trimmed}` };
  }
  return null;
}

/** Resolve a short URL (vm.tiktok.com / vt.tiktok.com) to its final destination.
 *
 * Uses GET with redirect:'manual' because:
 *   1. TikTok's short-link server returns 301 with a Location header on GET,
 *      but on HEAD it sometimes returns 200 with no Location (or follows a
 *      different redirect chain that ends at a geo-block page).
 *   2. Following redirects all the way with 'follow' can land on a geo-block
 *      page (e.g. /hk/about) when the sandbox's IP isn't allowlisted by
 *      TikTok's edge. We only need the FIRST hop (the canonical video URL),
 *      so manual redirect is both safer and more reliable.
 *
 * Falls back to redirect:'follow' if manual fails (returns 2xx without
 * a Location header), in which case res.url is the final URL.
 */
export async function resolveTiktokShortUrl(url: string): Promise<string> {
  // First try: GET with manual redirect — capture the Location header.
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const location = res.headers.get('location');
    if (location) return location;
    // No Location header — if we somehow got a 2xx, return the final URL.
    if (res.ok) return res.url;
  } catch {
    // fall through to follow-mode retry
  }

  // Fallback: GET with redirect:'follow' (less reliable due to geo-blocks,
  // but matches the original behaviour as a last resort).
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  return res.url;
}

// ---------------------------------------------------------------------------
// TikWM API client
// ---------------------------------------------------------------------------
const TIKWM_API = 'https://www.tikwm.com/api/';

interface TikwmResponse {
  code: number;
  msg: string;
  processed_time: number;
  data?: Record<string, unknown>;
}

export class TiktokClient {
  private userAgent: string;
  private proxy?: string;

  constructor(opts: { userAgent?: string; proxy?: string } = {}) {
    this.userAgent =
      opts.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.proxy = opts.proxy;
  }

  /**
   * Fetch video metadata + a direct play URL.
   * Uses TikWM as the primary source (no auth, returns JSON with play URL).
   */
  async getVideoInfo(url: string): Promise<TiktokVideoInfo> {
    const parsed = parseTiktokUrl(url);
    if (!parsed) throw new Error(`Could not parse TikTok URL: ${url}`);

    let resolvedUrl = url;
    if (parsed.kind === 'short') {
      try {
        resolvedUrl = await resolveTiktokShortUrl(url);
      } catch {
        /* fall through with original */
      }
    }

    // Try TikWM, with 2 retries — most failures here are transient (rate-limit
    // blips, momentary API hiccups) rather than the video actually being gone.
    let lastTikwmErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const info = await this.getViaTikwm(resolvedUrl);
        if (info) return info;
        lastTikwmErr = new Error('TikWM returned no play URL');
      } catch (err) {
        lastTikwmErr = err;
        console.warn(`[tiktok] TikWM attempt ${attempt}/3 failed:`, err instanceof Error ? err.message : err);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
    void lastTikwmErr;

    // Fallback: try yt-dlp
    try {
      const info = await this.getViaYtdlp(resolvedUrl);
      if (info) return info;
    } catch (err) {
      console.warn('[tiktok] yt-dlp failed:', err instanceof Error ? err.message : err);
    }

    throw new Error(
      `Could not fetch TikTok video info. Both TikWM and yt-dlp failed. ` +
        `Make sure yt-dlp is installed (pip install yt-dlp) and the video is public.`,
    );
  }

  private async getViaTikwm(url: string): Promise<TiktokVideoInfo | null> {
    const apiUrl = `${TIKWM_API}?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`TikWM HTTP ${res.status}`);
    const json = (await res.json()) as TikwmResponse;
    if (json.code !== 0 || !json.data) {
      throw new Error(`TikWM error: ${json.msg || 'unknown'}`);
    }
    const d = json.data;
    const playUrl = (d.play as string) || '';
    if (!playUrl) return null;

    // TikWM returns relative URLs for play/music — prefix with https://www.tikwm.com
    const absolutize = (u?: string) => {
      if (!u) return undefined;
      if (u.startsWith('http')) return u;
      return `https://www.tikwm.com${u}`;
    };

    return {
      id: String(d.id || ''),
      url,
      author: String((d.author as { nickname?: string })?.nickname || ''),
      authorId: String((d.author as { unique_id?: string })?.unique_id || ''),
      authorAvatar: (d.author as { avatar?: string })?.avatar,
      title: String(d.title || ''),
      description: String(d.title || ''),
      cover: String(d.cover || ''),
      dynamicCover: (d.ai_dynamic_cover as string) || undefined,
      originCover: (d.origin_cover as string) || undefined,
      duration: Number(d.duration || 0),
      playUrl: absolutize(playUrl) || playUrl,
      playUrlNoWatermark: absolutize((d.play as string) || ''),
      downloadUrl: absolutize((d.wmplay as string) || playUrl),
      musicUrl: absolutize((d.music as string) || undefined),
      musicTitle: (d.music_info as { title?: string })?.title,
      musicAuthor: (d.music_info as { author?: string })?.author,
      viewCount: Number(d.play_count || 0),
      likeCount: Number(d.digg_count || 0),
      commentCount: Number(d.comment_count || 0),
      shareCount: Number(d.share_count || 0),
      downloadCount: Number(d.download_count || 0),
      createdAt: Number(d.create_time || 0) || undefined,
      region: String(d.region || ''),
    };
  }

  private async getViaYtdlp(url: string): Promise<TiktokVideoInfo | null> {
    const ytdlpPath = await findYtdlp();
    if (!ytdlpPath) return null;

    const jsonStr = await runCommand(ytdlpPath, [
      '--no-warnings',
      '--no-playlist',
      '--dump-json',
      // yt-dlp's curl_cffi backend ships its own CA bundle which is missing/stale
      // on some Windows setups ("unable to get local issuer certificate"), which
      // otherwise breaks this whole fallback path. This only affects yt-dlp's own
      // fetches of public TikTok video data — nothing else in the app.
      '--no-check-certificates',
      '--user-agent',
      this.userAgent,
      url,
    ]);
    if (!jsonStr.trim()) return null;

    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const formats = (data.formats as Array<Record<string, unknown>>) || [];
    const mp4 = formats.find((f) => f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4');
    const playUrl = (mp4?.url as string) || (data.url as string) || '';

    return {
      id: String(data.id || ''),
      url,
      author: String(data.uploader || data.channel || ''),
      authorId: String(data.uploader_id || data.channel_id || ''),
      title: String(data.title || ''),
      description: String(data.description || ''),
      cover: String(data.thumbnail || ''),
      duration: Number(data.duration || 0),
      playUrl,
      downloadUrl: playUrl,
      viewCount: Number(data.view_count || 0),
      likeCount: Number(data.like_count || 0),
      commentCount: Number(data.comment_count || 0),
      shareCount: Number(data.share_count || 0) || undefined,
      createdAt: Number(data.timestamp || 0) || undefined,
      region: String(data._geo_bypassed_country || ''),
    };
  }

  /**
   * Download the video to a local file.
   * Tries TikWM direct URL first (fast, no auth); falls back to yt-dlp.
   *
   * When `onProgress` is provided, it is called periodically as bytes are
   * received — wired up to the API's progress broker so the React UI can show
   * a real progress bar instead of an indefinite spinner.
   */
  async downloadVideo(
    info: TiktokVideoInfo,
    outputDir: string,
    filename?: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<TiktokDownloadResult> {
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    const finalName = withExtension(filename || `tiktok-${info.id || 'video'}`, '.mp4');
    const outputPath = join(outputDir, finalName);
    const start = Date.now();

    // Strategy 1: direct download from TikWM play URL (streamed)
    try {
      const res = await fetch(info.playUrl, { headers: { 'User-Agent': this.userAgent } });
      if (res.ok && res.body) {
        const totalHeader = res.headers.get('content-length');
        const total = totalHeader ? Number(totalHeader) : 0;
        let received = 0;
        const fh = await openWriteHandle(outputPath);
        const reader = res.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.length === 0) continue;
            await fh.write(value);
            received += value.length;
            if (onProgress) {
              onProgress({
                receivedBytes: received,
                totalBytes: total,
                percent: total > 0 ? Math.min(100, (received / total) * 100) : 0,
                speedBps: received / Math.max(1, (Date.now() - start) / 1000),
              });
            }
          }
        } finally {
          await fh.close();
        }
        if (received > 1024) {
          if (onProgress) {
            onProgress({
              receivedBytes: received,
              totalBytes: total || received,
              percent: 100,
              speedBps: received / Math.max(1, (Date.now() - start) / 1000),
            });
          }
          return {
            filePath: outputPath,
            fileSize: received,
            durationMs: Date.now() - start,
            source: info.playUrl.includes('tikwm') ? 'tikwm' : 'direct',
            mimeType: 'video/mp4',
          };
        }
        // File too small, treat as failure and try yt-dlp.
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(outputPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn('[tiktok] direct download failed:', err instanceof Error ? err.message : err);
    }

    // Strategy 2: yt-dlp (with progress parsing)
    const ytdlpPath = await findYtdlp();
    if (ytdlpPath) {
      await runYtdlpWithProgress(ytdlpPath, [
        '--no-warnings',
        '--no-playlist',
        '--no-check-certificates',
        '--newline',
        '--progress',
        '--progress-template',
        'PROGRESS::%(progress._percent_str)s::%(progress._downloaded_bytes)d::%(progress._total_bytes)d::%(progress._speed_str)s',
        '-f',
        'mp4',
        '-o',
        outputPath,
        '--user-agent',
        this.userAgent,
        info.url,
      ], onProgress, start);
      const { stat } = await import('node:fs/promises');
      const stats = await stat(outputPath);
      if (onProgress) {
        onProgress({
          receivedBytes: stats.size,
          totalBytes: stats.size,
          percent: 100,
          speedBps: stats.size / Math.max(1, (Date.now() - start) / 1000),
        });
      }
      return {
        filePath: outputPath,
        fileSize: stats.size,
        durationMs: Date.now() - start,
        source: 'ytdlp',
        mimeType: 'video/mp4',
      };
    }

    throw new Error('All download strategies failed. Install yt-dlp for better results: pip install yt-dlp');
  }

  /**
   * Download the music track (mp3) of a video.
   */
  async downloadMusic(
    info: TiktokVideoInfo,
    outputDir: string,
    filename?: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<TiktokDownloadResult> {
    if (!info.musicUrl) throw new Error('Video has no music URL');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    const finalName = withExtension(filename || `tiktok-music-${info.id || 'audio'}`, '.mp3');
    const outputPath = join(outputDir, finalName);
    const start = Date.now();

    const res = await fetch(info.musicUrl, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) throw new Error(`Music download HTTP ${res.status}`);
    if (!res.body) throw new Error('Music response had no body');

    const totalHeader = res.headers.get('content-length');
    const total = totalHeader ? Number(totalHeader) : 0;
    let received = 0;
    const fh = await openWriteHandle(outputPath);
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        await fh.write(value);
        received += value.length;
        if (onProgress) {
          onProgress({
            receivedBytes: received,
            totalBytes: total,
            percent: total > 0 ? Math.min(100, (received / total) * 100) : 0,
            speedBps: received / Math.max(1, (Date.now() - start) / 1000),
          });
        }
      }
    } finally {
      await fh.close();
    }
    if (onProgress) {
      onProgress({
        receivedBytes: received,
        totalBytes: total || received,
        percent: 100,
        speedBps: received / Math.max(1, (Date.now() - start) / 1000),
      });
    }
    return {
      filePath: outputPath,
      fileSize: received,
      durationMs: Date.now() - start,
      source: 'tikwm',
      mimeType: 'audio/mpeg',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a filename carries the expected extension. Callers (the download UI)
 * pass a name derived from the video title, which has no extension — without
 * this the file lands on disk with no `.mp4`/`.mp3` and Windows can't tell what
 * it is. An already-correct extension is left alone (case-insensitive).
 */
function withExtension(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
}

async function findYtdlp(): Promise<string | null> {
  // Check common install locations
  const candidates = ['yt-dlp', '/home/z/.local/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
  for (const c of candidates) {
    try {
      await runCommand(c, ['--version']);
      return c;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/** Open a file for writing as a Bun FileSink (Bun) or fs.WriteStream (Node). */
async function openWriteHandle(path: string): Promise<{
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}> {
  // Prefer Bun.file().writer() for fast appendable writes; fall back to fs on Node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bun: any = (globalThis as any).Bun;
  if (bun?.file) {
    const sink = bun.file(path).writer();
    return {
      // Bun's FileSink.write() is SYNCHRONOUS — it returns the number of
      // bytes written (a number), not a Promise. Only `.flush()` and
      // `.end()` return Promises. Wrapping it in Promise.resolve keeps
      // the async interface uniform with the Node branch below.
      write: (chunk) => {
        try {
          const written = sink.write(chunk);
          // If a future Bun version returns a Promise, await it.
          if (written && typeof (written as Promise<void>).then === 'function') {
            return (written as Promise<void>).then(() => undefined);
          }
          return Promise.resolve();
        } catch (err) {
          return Promise.reject(err);
        }
      },
      close: async () => {
        await sink.end();
      },
    };
  }
  const { createWriteStream } = await import('node:fs');
  const stream = createWriteStream(path);
  return {
    write: (chunk) => new Promise<void>((resolve, reject) => {
      const ok = stream.write(Buffer.from(chunk), (err) => {
        if (err) reject(err);
      });
      if (ok) resolve();
      else stream.once('drain', () => resolve());
    }),
    close: () => new Promise<void>((resolve) => stream.end(() => resolve())),
  };
}

/** Spawn yt-dlp and stream progress events parsed from stdout. */
function runYtdlpWithProgress(
  cmd: string,
  args: string[],
  onProgress: DownloadProgressCallback | undefined,
  startedAt: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onProgress) parseProgressLine(text, onProgress, startedAt);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

/**
 * Parse lines emitted by yt-dlp --progress-template. Our template looks like:
 *   PROGRESS::50.0%::1234567::2469134::1.23MiB/s
 * The fields may be 'NA' when yt-dlp can't determine them (eg. live streams).
 */
function parseProgressLine(
  raw: string,
  cb: DownloadProgressCallback,
  startedAt: number,
): void {
  const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('PROGRESS::')) continue;
    const parts = line.split('::');
    if (parts.length < 5) continue;
    const [, pctStr, dlStr, totalStr, speedStr] = parts;
    const percent = parsePercent(pctStr);
    const received = parseSize(dlStr);
    const total = parseSize(totalStr);
    // Speed is informational; the broker computes its own running average,
    // but we forward it so the UI can show a near-instantaneous rate.
    const speedBps = parseSpeed(speedStr);
    void elapsedSec;
    cb({
      receivedBytes: received,
      totalBytes: total,
      percent,
      speedBps: speedBps || received / elapsedSec,
    });
  }
}

function parsePercent(s: string | undefined): number {
  if (!s || s === 'NA' || s === 'Unknown') return 0;
  const m = s.match(/([\d.]+)\s*%?/);
  if (!m) return 0;
  return Math.min(100, Math.max(0, parseFloat(m[1])));
}

function parseSize(s: string | undefined): number {
  if (!s || s === 'NA' || s === 'Unknown') return 0;
  const m = s.match(/([\d.]+)\s*(Ki?B|Mi?B|Gi?B|Ti?B|B)?/i);
  if (!m) return parseInt(s, 10) || 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toLowerCase();
  if (unit.startsWith('k')) return n * 1024;
  if (unit.startsWith('m')) return n * 1024 * 1024;
  if (unit.startsWith('g')) return n * 1024 * 1024 * 1024;
  if (unit.startsWith('t')) return n * 1024 * 1024 * 1024 * 1024;
  return n;
}

function parseSpeed(s: string | undefined): number {
  if (!s || s === 'NA' || s === 'Unknown') return 0;
  return parseSize(s);
}

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}
