/**
 * @sleiz/bilibili - Bilibili API client.
 *
 * References:
 *   https://github.com/SocialSisterYi/bilibili-API-collect
 *
 * Supported:
 *   - Parse BV/av/episode URLs
 *   - Get video metadata (title, uploader, cover, description, duration)
 *   - Get episode list (for bangumi / collection)
 *   - Get subtitle list (per language)
 *   - Download subtitle (converted to SRT)
 *
 * Note: Bilibili enforces WBI signature on many endpoints. For the public
 * endpoints we use here (view, subtitle), the simple SESSDATA cookie is enough.
 */

import type { BilibiliVideoInfo, BilibiliEpisode, BilibiliSubtitle } from '@sleiz/shared';

const API_BASE = 'https://api.bilibili.com';

export class BilibiliClient {
  private cookie: string;
  private userAgent: string;

  constructor(opts: { cookie?: string; userAgent?: string } = {}) {
    this.cookie = opts.cookie || process.env.BILIBILI_COOKIE || '';
    this.userAgent =
      opts.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  private headers(): Record<string, string> {
    return {
      'User-Agent': this.userAgent,
      Referer: 'https://www.bilibili.com',
      Cookie: this.cookie,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    };
  }

  /** Parse any Bilibili URL or BV id into a normalized identifier. */
  parseUrl(input: string): { kind: 'bv' | 'av' | 'ep' | 'ss'; id: string } | null {
    const trimmed = input.trim();
    // Direct BV id
    const bvMatch = trimmed.match(/^(BV[0-9A-Za-z]{10})$/);
    if (bvMatch) return { kind: 'bv', id: bvMatch[1] };
    // Direct av id
    const avMatch = trimmed.match(/^av(\d+)$/i);
    if (avMatch) return { kind: 'av', id: avMatch[1] };
    // Direct ep id
    const epMatch = trimmed.match(/^ep(\d+)$/i);
    if (epMatch) return { kind: 'ep', id: epMatch[1] };
    // URL forms
    const urlBv = trimmed.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/);
    if (urlBv) return { kind: 'bv', id: urlBv[1] };
    const urlAv = trimmed.match(/bilibili\.com\/video\/av(\d+)/i);
    if (urlAv) return { kind: 'av', id: urlAv[1] };
    const urlEp = trimmed.match(/bilibili\.com\/bangumi\/play\/ep(\d+)/i);
    if (urlEp) return { kind: 'ep', id: urlEp[1] };
    const urlSs = trimmed.match(/bilibili\.com\/bangumi\/play\/ss(\d+)/i);
    if (urlSs) return { kind: 'ss', id: urlSs[1] };
    const urlEpShort = trimmed.match(/\/ep(\d+)(?:[/?#]|$)/i);
    if (urlEpShort) return { kind: 'ep', id: urlEpShort[1] };
    const urlSsShort = trimmed.match(/\/ss(\d+)(?:[/?#]|$)/i);
    if (urlSsShort) return { kind: 'ss', id: urlSsShort[1] };
    // b23.tv short link - caller should resolve via HTTP redirect
    if (/b23\.tv\//.test(trimmed)) return { kind: 'bv', id: trimmed };
    return null;
  }

  /** Fetch video metadata from a BV or av identifier. */
  async getVideoInfo(id: string, kind: 'bv' | 'av' = 'bv'): Promise<BilibiliVideoInfo> {
    const params = new URLSearchParams(kind === 'bv' ? [['bvid', id]] : [['aid', id]]);
    const url = `${API_BASE}/x/web-interface/view?${params}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bilibili view API ${res.status}`);
    const data = (await res.json()) as BilibiliViewResponse;
    if (data.code !== 0) throw new Error(`Bilibili error: ${data.message}`);

    const v = data.data;
    let episodes: BilibiliEpisode[] = [];
    let infoKind: BilibiliVideoInfo['kind'] = 'video';

    if (v.ugc_season?.sections?.length) {
      infoKind = 'ugc-season';
      episodes = v.ugc_season.sections.flatMap((section, sectionIndex) =>
        (section.episodes || []).map((ep, idx) => ({
          id: ep.id || ep.cid || idx,
          title: ep.title || `Tập ${idx + 1}`,
          aid: ep.aid || v.aid,
          cid: ep.cid,
          duration: ep.duration || v.duration,
          cover: ep.arc?.pic || v.pic,
          bvid: ep.bvid || ep.arc?.bvid || null,
          url: ep.arc?.bvid
            ? `https://www.bilibili.com/video/${ep.arc.bvid}`
            : `https://www.bilibili.com/video/av${ep.aid}`,
          sectionTitle: section.title || `Phần ${sectionIndex + 1}`,
        })),
      );
    } else {
      // Build episode list from pages (single video has 1 page, collections have many)
      episodes = (v.pages || []).map((p, idx) => ({
        id: p.cid,
        title: p.part || `Tập ${idx + 1}`,
        aid: v.aid,
        cid: p.cid,
        duration: p.duration || v.duration,
        cover: v.pic,
        bvid: v.bvid,
        url: `https://www.bilibili.com/video/${v.bvid}${idx > 0 ? `?p=${idx + 1}` : ''}`,
      }));
    }

    return {
      kind: infoKind,
      bvid: v.bvid,
      aid: v.aid,
      title: v.ugc_season?.title || v.title,
      desc: v.ugc_season?.intro || v.desc,
      cover: v.pic,
      uploader: v.owner?.name || '',
      uploaderMid: v.owner?.mid || 0,
      duration: v.duration,
      pubdate: v.pubdate,
      seasonId: v.ugc_season?.id || null,
      mediaId: null,
      isPlaylist: episodes.length > 1,
      episodes,
    };
  }

  async getBangumiInfo(id: string, kind: 'ss' | 'ep' = 'ss'): Promise<BilibiliVideoInfo> {
    const params = new URLSearchParams(kind === 'ss' ? [['season_id', id]] : [['ep_id', id]]);
    const url = `${API_BASE}/pgc/view/web/season?${params}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bilibili bangumi API ${res.status}`);
    const data = (await res.json()) as BilibiliBangumiResponse;
    if (data.code !== 0 || !data.result) throw new Error(`Bilibili error: ${data.message}`);

    const season = data.result;
    const sections = [
      { title: season.positive?.title || 'Chính truyện', episodes: season.episodes || [] },
      ...(season.section || []).map((item) => ({
        title: item.title || 'Phần khác',
        episodes: item.episodes || [],
      })),
    ];

    const episodes: BilibiliEpisode[] = sections.flatMap((section) =>
      (section.episodes || []).map((ep, index) => ({
        id: ep.id || ep.ep_id || index,
        title: normalizeBangumiEpisodeTitle(ep, index),
        aid: ep.aid || 0,
        cid: ep.cid || 0,
        duration: ep.duration || 0,
        cover: ep.cover || season.cover,
        bvid: ep.bvid || null,
        url: ep.link || ep.share_url || (ep.bvid ? `https://www.bilibili.com/video/${ep.bvid}` : null),
        sectionTitle: section.title,
        epId: ep.id || ep.ep_id || null,
      })),
    );

    const first = episodes[0];
    return {
      kind: 'bangumi',
      bvid: first?.bvid || '',
      aid: first?.aid || 0,
      title: season.title || season.season_title,
      desc: season.evaluate || season.subtitle || '',
      cover: season.cover,
      uploader: season.up_info?.uname || '',
      uploaderMid: season.up_info?.mid || 0,
      duration: first?.duration || 0,
      pubdate: 0,
      seasonId: season.season_id,
      mediaId: season.media_id,
      isPlaylist: episodes.length > 1,
      episodes,
    };
  }

  /** Get subtitle list for a video (cid). Returns the language options. */
  async getSubtitles(aid: number, cid: number): Promise<BilibiliSubtitle[]> {
    const url = `${API_BASE}/x/player/v2?aid=${aid}&cid=${cid}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bilibili player API ${res.status}`);
    const data = (await res.json()) as BilibiliPlayerResponse;
    if (data.code !== 0) throw new Error(`Bilibili error: ${data.message}`);
    const subs = data.data?.subtitle?.subtitles || [];
    return subs.map((s) => ({
      lan: s.lan,
      lanDoc: s.lan_doc,
      subtitleUrl: s.subtitle_url.startsWith('//') ? `https:${s.subtitle_url}` : s.subtitle_url,
      aiType: s.ai_type ?? 0,
    }));
  }

  /** Download a subtitle file and convert it to SRT. */
  async downloadSubtitleAsSrt(subtitleUrl: string): Promise<string> {
    const res = await fetch(subtitleUrl, { headers: this.headers() });
    if (!res.ok) throw new Error(`Subtitle download ${res.status}`);
    const data = (await res.json()) as { body?: Array<{ from: number; to: number; content: string }> };
    const body = data.body || [];
    const lines: string[] = [];
    body.forEach((item, idx) => {
      lines.push(String(idx + 1));
      lines.push(`${srtTime(item.from)} --> ${srtTime(item.to)}`);
      lines.push(item.content);
      lines.push('');
    });
    return lines.join('\n');
  }

  /** Resolve a b23.tv short link to its target URL. */
  async resolveShortLink(url: string): Promise<string> {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: this.headers(),
    });
    return res.url;
  }

  /** Get video stream URL (note: actual download requires signed params; for
   *  this MVP we return the playurl info and let the user download via a
   *  separate tool such as yt-dlp). */
  async getPlayUrl(aid: number, cid: number, quality = 80): Promise<unknown> {
    const url = `${API_BASE}/x/player/playurl?aid=${aid}&cid=${cid}&qn=${quality}&fnval=4048&fourk=1`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Bilibili playurl API ${res.status}`);
    const data = (await res.json()) as { code: number; message: string; data?: unknown };
    if (data.code !== 0) throw new Error(`Bilibili error: ${data.message}`);
    return data.data;
  }

  /**
   * Download a Bilibili video to a local MP4 file using yt-dlp + cookie.
   *
   * Requires:
   *   - yt-dlp installed (pip install yt-dlp)
   *   - cookie configured (via constructor or BILIBILI_COOKIE env)
   *
   * yt-dlp handles Bilibili's WBI signing and gives us the highest-quality
   * stream available for the logged-in user.
   *
   * When `onProgress` is provided, the function parses yt-dlp's
   * `--progress-template` output and reports received bytes / total bytes /
   * speed to the broker, so the React UI can render a real progress bar.
   */
  async downloadVideo(
    bvidOrUrl: string,
    outputDir: string,
    opts: {
      quality?: string;
      filename?: string;
      cookieFile?: string;
      onProgress?: DownloadProgressCallback;
    } = {},
  ): Promise<BilibiliDownloadResult> {
    const { spawn } = await import('node:child_process');
    const { mkdir, stat } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    // Locate yt-dlp
    const ytdlpPath = await findYtdlp();
    if (!ytdlpPath) {
      throw new Error(
        'yt-dlp is not installed. Install it with: pip install --break-system-packages yt-dlp',
      );
    }

    // Write cookie to a temp Netscape-format file
    const cookieFile = opts.cookieFile || (await this.writeCookieFile());

    const url = bvidOrUrl.startsWith('http')
      ? bvidOrUrl
      : `https://www.bilibili.com/video/${bvidOrUrl}`;

    // Sanitize filename
    const baseName = (opts.filename || `bilibili-${bvidOrUrl.replace(/^BV/, 'BV')}`).replace(
      /\.mp4$/i,
      '',
    );
    const outputPath = join(outputDir, `${baseName}.mp4`);
    const start = Date.now();

    // Build a stable progress-template key so the parser can recognize our lines.
    // We also ask yt-dlp to write the file in a streaming fashion so the on-disk
    // size can be observed as it grows.
    const args = [
      '--no-warnings',
      '--no-playlist',
      '--newline',
      '--progress',
      '--progress-template',
      'PROGRESS::%(progress._percent_str)s::%(progress._downloaded_bytes)d::%(progress._total_bytes)d::%(progress._speed_str)s',
      '--cookies',
      cookieFile,
      '-f',
      'bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath,
      url,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let stdoutBuf = '';
      proc.stdout.on('data', (d) => {
        const text = d.toString();
        stdoutBuf += text;
        if (opts.onProgress) {
          parseYtdlpProgressChunk(text, opts.onProgress, start);
        }
      });
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          // Flush any tail of stdout the parser may have missed (no trailing newline)
          if (opts.onProgress) parseYtdlpProgressChunk(stdoutBuf, opts.onProgress, start);
          resolve();
        } else {
          reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 400)}`));
        }
      });
    });

    let fileSize = 0;
    try {
      fileSize = (await stat(outputPath)).size;
    } catch {
      /* file may not exist if yt-dlp merged and removed */
    }

    if (opts.onProgress) {
      opts.onProgress({
        receivedBytes: fileSize,
        totalBytes: fileSize,
        percent: 100,
        speedBps: fileSize / Math.max(1, (Date.now() - start) / 1000),
      });
    }

    return {
      filePath: outputPath,
      fileSize,
      durationMs: Date.now() - start,
      source: 'ytdlp',
      mimeType: 'video/mp4',
    };
  }

  /** Write the Bilibili cookie string to a temporary Netscape-format cookie file. */
  private async writeCookieFile(): Promise<string> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const os = await import('node:os');
    const { join } = await import('node:path');

    const dir = join(os.tmpdir(), 'sleiz-studio');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'bilibili_cookies.txt');

    if (!this.cookie) {
      throw new Error('Bilibili cookie is not configured. Set BILIBILI_COOKIE in .env or settings.');
    }

    const lines = ['# Netscape HTTP Cookie File'];
    for (const cookie of this.cookie.split('; ')) {
      const eq = cookie.indexOf('=');
      if (eq === -1) continue;
      const name = cookie.slice(0, eq);
      const value = cookie.slice(eq + 1);
      lines.push(`.bilibili.com\tTRUE\t/\tTRUE\t9999999999\t${name}\t${value}`);
    }
    await writeFile(path, lines.join('\n'));
    return path;
  }
}

export interface BilibiliDownloadResult {
  filePath: string;
  fileSize: number;
  durationMs: number;
  source: 'ytdlp';
  mimeType: string;
}

/**
 * Progress callback for streaming downloads.
 * Same shape as the TikTok client so the API layer can share a single broker.
 */
export interface DownloadProgressEvent {
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  speedBps: number;
}
export type DownloadProgressCallback = (e: DownloadProgressEvent) => void;

async function findYtdlp(): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const candidates = ['yt-dlp', '/home/z/.local/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
  for (const c of candidates) {
    try {
      await execFileAsync(c, ['--version']);
      return c;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function srtTime(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  const s = Math.floor(seconds) % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/**
 * Parse yt-dlp --progress-template lines. Format produced by our args:
 *   PROGRESS::50.0%::1234567::2469134::1.23MiB/s
 * Fields may be 'NA' when yt-dlp can't determine them (eg. live streams).
 */
function parseYtdlpProgressChunk(
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
    const percent = parsePercentValue(pctStr);
    const received = parseSizeValue(dlStr);
    const total = parseSizeValue(totalStr);
    const speedBps = parseSizeValue(speedStr);
    cb({
      receivedBytes: received,
      totalBytes: total,
      percent,
      speedBps: speedBps || received / elapsedSec,
    });
  }
}

function parsePercentValue(s: string | undefined): number {
  if (!s || s === 'NA' || s === 'Unknown') return 0;
  const m = s.match(/([\d.]+)\s*%?/);
  if (!m) return 0;
  return Math.min(100, Math.max(0, parseFloat(m[1])));
}

function parseSizeValue(s: string | undefined): number {
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
function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

// ---------------------------------------------------------------------------
// Bilibili response types (subset we use)
// ---------------------------------------------------------------------------
interface BilibiliViewResponse {
  code: number;
  message: string;
  data: {
    bvid: string;
    aid: number;
    title: string;
    desc: string;
    pic: string;
    duration: number;
    pubdate: number;
    owner: { name: string; mid: number };
    pages: Array<{ cid: number; part: string; duration: number }>;
    ugc_season?: {
      id: number;
      title: string;
      intro?: string;
      sections?: Array<{
        section_id?: number;
        title?: string;
        episodes?: Array<{
          id: number;
          aid: number;
          cid: number;
          title: string;
          bvid?: string;
          duration?: number;
          arc?: { pic?: string; bvid?: string };
        }>;
      }>;
    };
  };
}

interface BilibiliPlayerResponse {
  code: number;
  message: string;
  data?: {
    subtitle?: {
      subtitles?: Array<{ lan: string; lan_doc: string; subtitle_url: string; ai_type?: number }>;
    };
  };
}

interface BilibiliBangumiResponse {
  code: number;
  message: string;
  result?: {
    title: string;
    season_title: string;
    subtitle?: string;
    evaluate?: string;
    cover: string;
    media_id: number;
    season_id: number;
    episodes?: Array<BilibiliBangumiEpisode>;
    positive?: { title?: string };
    section?: Array<{ title?: string; episodes?: Array<BilibiliBangumiEpisode> }>;
    up_info?: { uname?: string; mid?: number };
  };
}

interface BilibiliBangumiEpisode {
  aid?: number;
  bvid?: string;
  cid?: number;
  cover?: string;
  duration?: number;
  ep_id?: number;
  id?: number;
  link?: string;
  long_title?: string;
  share_url?: string;
  show_title?: string;
  title?: string;
  pub_time?: number;
  pubTime?: number;
}

function normalizeBangumiEpisodeTitle(ep: BilibiliBangumiEpisode, index: number): string {
  const title = [ep.show_title, ep.title, ep.long_title]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return title[0] || `Tập ${index + 1}`;
}

export type { BilibiliVideoInfo, BilibiliEpisode, BilibiliSubtitle };
