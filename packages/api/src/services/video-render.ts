import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { exportAss, exportSrt } from '@sleiz/subtitle';
import type { SubtitleCue } from '@sleiz/shared';
import { UPLOAD_DIR } from '../routes/upload.js';
import { rt } from './realtime.js';

const GROQ_TTS_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech';
const GROQ_TTS_MODELS = new Set([
  'canopylabs/orpheus-v1-english',
  'canopylabs/orpheus-arabic-saudi',
]);
const GROQ_TTS_VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);

export interface RenderVideoOptions {
  episodeId: string;
  subtitleId: string;
  audioMode?: 'replace' | 'duck';
  ttsEngine?: 'revid' | 'edge' | 'groq';
  model?: string;
  voice?: string;
  watermarkText?: string;
  bgVolume?: number;
}

interface ScheduledClip {
  filePath: string;
  startMs: number;
  maxDurationMs: number;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function updateJob(db: DB, id: string, patch: Record<string, unknown>) {
  db.update(schema.jobs).set({ ...patch, updatedAt: now() }).where(eq(schema.jobs.id, id)).run();
  rt.updated('jobs', id);
}

function getJobStatus(db: DB, id: string) {
  return db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, id)).get()?.status;
}

function assertNotCancelled(db: DB, id: string) {
  if (getJobStatus(db, id) === 'cancelled') throw new Error('Đã hủy tác vụ kết xuất.');
}

function run(binary: string, args: string[], label: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', (error) => {
      reject(new Error(`${label}: ${error.message}. Hãy cài FFmpeg và thêm ffmpeg/ffprobe vào PATH.`));
    });
    child.once('close', (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${label} thất bại (mã ${code ?? 'không xác định'}): ${output.slice(-1400)}`));
    });
  });
}

async function durationMs(filePath: string): Promise<number> {
  const output = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], 'Không thể đọc thời lượng audio');
  const seconds = Number.parseFloat(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('FFprobe không trả về thời lượng audio hợp lệ.');
  return Math.max(1, Math.round(seconds * 1000));
}

function sourcePathFromUrl(value: string): string {
  if (!value.startsWith('/uploads/')) throw new Error('Video phải được tải lên trong Sleiz Studio trước khi kết xuất.');
  const relative = value.slice('/uploads/'.length).replace(/\\/g, '/');
  const resolved = resolve(UPLOAD_DIR, relative);
  const root = resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root) || !existsSync(resolved)) throw new Error('Không tìm thấy file video đã tải lên.');
  return resolved;
}

function splitSpeech(text: string): string[] {
  const source = text.trim().replace(/\s+/g, ' ');
  if (source.length <= 150) return [source];
  const parts: string[] = [];
  let remaining = source;
  while (remaining.length > 150) {
    let cut = Math.max(remaining.lastIndexOf('. ', 150), remaining.lastIndexOf(', ', 150), remaining.lastIndexOf(' ', 150));
    if (cut < 30) cut = 150;
    parts.push(remaining.slice(0, cut + (remaining[cut] === ' ' ? 0 : 1)).trim());
    remaining = remaining.slice(cut + 1).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

const REVID_FALLBACK_VOICE = 'vi-VN-HoaiMyNeural';
// Errors that mean "this voice/engine combo is not supported" — we can
// transparently fall back to a known-good voice instead of failing the job.
const REVID_RETRYABLE_FAILURE_PATTERNS = [
  'no audio was received',
  'invalid speaker/voice',
  'piper model not found',
  'is not available for model',
];

function isRevidRetryableFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return REVID_RETRYABLE_FAILURE_PATTERNS.some((pattern) => lower.includes(pattern));
}

async function generateSpeechWithRevid(
  text: string,
  revidApiKey: string,
  engine: string,
  voice: string,
  destination: string,
): Promise<void> {
  const requestedVoice = voice || REVID_FALLBACK_VOICE;
  try {
    await callRevidTts(text, revidApiKey, engine || 'edge', requestedVoice, destination);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (requestedVoice !== REVID_FALLBACK_VOICE && isRevidRetryableFailure(message)) {
      console.warn(
        `[revid-tts] voice "${requestedVoice}" không khả dụng (${message}). Tự động dùng "${REVID_FALLBACK_VOICE}".`,
      );
      await callRevidTts(text, revidApiKey, engine || 'edge', REVID_FALLBACK_VOICE, destination);
      return;
    }
    throw error;
  }
}

async function callRevidTts(
  text: string,
  revidApiKey: string,
  engine: string,
  voice: string,
  destination: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (revidApiKey) {
    headers['x-api-key'] = revidApiKey;
    headers['Authorization'] = `Bearer ${revidApiKey}`;
  }

  const payload = {
    text,
    engine,
    voice,
    speed: 1.0,
  };

  const response = await fetch('https://api.revidapi.com/paid/text-to-speech', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Revid API TTS lỗi ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const rawData = (await response.json().catch(() => ({}))) as Record<string, unknown> | Array<Record<string, unknown>>;
  const resItem = (Array.isArray(rawData) ? rawData[0] : rawData) || {};
  const taskId = (resItem.task_id || resItem.id || resItem.taskId) as string | undefined;
  const pollUrl = (resItem.get_result || (taskId ? `https://tts.revidapi.com/api/get/${taskId}` : null)) as string | null;

  if (resItem.audio_url || resItem.url) {
    const audioUrl = String(resItem.audio_url || resItem.url);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Không thể tải audio từ Revid API (${audioRes.status})`);
    const audioBuf = await audioRes.arrayBuffer();
    await Bun.write(destination, audioBuf);
    return;
  }

  if (!pollUrl) {
    throw new Error(`Revid API TTS không trả về task_id hay get_result URL (voice=${voice}).`);
  }

  const maxAttempts = 30;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((res) => setTimeout(res, 1500));
    const statusRes = await fetch(pollUrl, { headers });
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(statusData.status || '');
    const resultObj = (statusData.result || statusData) as Record<string, unknown>;
    const audioUrl = (resultObj as Record<string, unknown>).audio_url
      || (resultObj as Record<string, unknown>).url
      || (statusData as Record<string, unknown>).audio_url;

    if (status === 'completed' || status === 'success' || audioUrl) {
      if (!audioUrl) throw new Error(`Revid API TTS hoàn tất nhưng không có URL audio (voice=${voice}).`);
      const audioRes = await fetch(String(audioUrl));
      if (!audioRes.ok) throw new Error(`Không thể tải audio từ ${audioUrl}`);
      const audioBuf = await audioRes.arrayBuffer();
      await Bun.write(destination, audioBuf);
      return;
    }

    if (status === 'failed' || status === 'error') {
      const apiMessage = String(
        (statusData as Record<string, unknown>).error
        || (statusData as Record<string, unknown>).message
        || 'Lỗi không xác định',
      );
      throw new Error(`${apiMessage} (voice=${voice}, engine=${engine})`);
    }
  }

  throw new Error(`Revid API TTS hết thời gian chờ (voice=${voice}, timeout sau 45 giây).`);
}

async function generateSpeech(
  text: string,
  engine: 'revid' | 'edge' | 'groq',
  apiKey: string,
  revidApiKey: string,
  model: string,
  voice: string,
  destination: string,
): Promise<void> {
  if (engine === 'revid') {
    await generateSpeechWithRevid(text, revidApiKey, 'edge', voice || 'vi-VN-HoaiMyNeural', destination);
    return;
  }

  if (engine === 'edge') {
    const selectedVoice = voice || 'vi-VN-HoaiMyNeural';
    try {
      await run('edge-tts', ['--text', text, '--voice', selectedVoice, '--write-media', destination], 'Edge TTS thất bại');
      return;
    } catch {
      // Fallback directly to Revid API if local edge-tts is missing/fails
      await generateSpeechWithRevid(text, revidApiKey, 'edge', selectedVoice, destination);
      return;
    }
  }

  // Groq TTS engine
  if (!apiKey) throw new Error('Chưa cấu hình Groq API key.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(GROQ_TTS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: voice || 'autumn', input: text, response_format: 'wav' }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Groq TTS lỗi ${response.status}: ${detail.slice(0, 500)}`);
    }
    const audio = await response.arrayBuffer();
    if (audio.byteLength < 44) throw new Error('Groq TTS trả về audio không hợp lệ.');
    await Bun.write(destination, audio);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Groq TTS hết thời gian chờ sau 90 giây.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Executes an asynchronous, cue-synchronised Vietnamese dubbing render. */
export async function renderTranslatedVideo(db: DB, jobId: string, options: RenderVideoOptions): Promise<void> {
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, options.episodeId)).get();
  const subtitle = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, options.subtitleId)).get();
  if (!episode || !subtitle || subtitle.episodeId !== episode.id) throw new Error('Video hoặc phụ đề không hợp lệ.');
  if (!episode.videoPath) throw new Error('Hãy tải video lên trước khi kết xuất.');
  const sourceVideo = sourcePathFromUrl(episode.videoPath);
  const cues = JSON.parse(subtitle.cues) as SubtitleCue[];
  const missing = cues.find((cue) => !cue.textTranslated?.trim());
  if (missing) throw new Error(`Chưa thể tạo video: phụ đề dòng ${missing.index + 1} chưa được dịch tiếng Việt.`);

  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const apiKey = settings?.groqApiKey || process.env.GROQ_API_KEY || '';
  const revidApiKey = settings?.revidApiKey || process.env.REVID_API_KEY || '';
  const ttsEngine = options.ttsEngine || 'revid';
  const model = options.model || 'canopylabs/orpheus-v1-english';
  const voice = options.voice || (ttsEngine === 'revid' || ttsEngine === 'edge' ? 'vi-VN-HoaiMyNeural' : 'autumn');

  if (ttsEngine === 'groq') {
    if (!apiKey) throw new Error('Chưa cấu hình Groq API key trong Cài đặt.');
    if (!GROQ_TTS_MODELS.has(model) || !GROQ_TTS_VOICES.has(voice)) throw new Error('Cấu hình giọng Groq không hợp lệ.');
  }

  updateJob(db, jobId, { status: 'running', progress: 2, total: cues.length, startedAt: now(), error: null });
  await run('ffmpeg', ['-version'], 'Không thể chạy FFmpeg');
  await run('ffprobe', ['-version'], 'Không thể chạy FFprobe');
  assertNotCancelled(db, jobId);

  const workDir = join(UPLOAD_DIR, 'renders', jobId);
  mkdirSync(workDir, { recursive: true });
  const clips: ScheduledClip[] = [];
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    assertNotCancelled(db, jobId);
    const cue = cues[cueIndex];
    const pieces = splitSpeech(cue.textTranslated!.trim());
    let cursorMs = cue.startMs;
    for (let partIndex = 0; partIndex < pieces.length && cursorMs < cue.endMs; partIndex++) {
      const clipExt = ttsEngine === 'revid' || ttsEngine === 'edge' ? 'mp3' : 'wav';
      const clipPath = join(workDir, `cue-${String(cueIndex).padStart(5, '0')}-${partIndex}.${clipExt}`);
      await generateSpeech(pieces[partIndex], ttsEngine, apiKey, revidApiKey, model, voice, clipPath);
      clips.push({ filePath: clipPath, startMs: cursorMs, maxDurationMs: Math.max(1, cue.endMs - cursorMs) });
      const generatedDuration = await durationMs(clipPath);
      cursorMs += generatedDuration;
    }
    updateJob(db, jobId, { progress: Math.round(5 + ((cueIndex + 1) / cues.length) * 55), total: cues.length });
  }

  assertNotCancelled(db, jobId);
  const srtPath = join(workDir, 'subtitle-vi.srt');
  const assPath = join(workDir, 'subtitle-vi.ass');
  await Bun.write(srtPath, exportSrt(cues, { preferTranslated: true, translatedOnly: true }));
  await Bun.write(assPath, exportAss(cues, { preferTranslated: true, translatedOnly: true }));

  const filterPath = join(workDir, 'voice-filter.txt');
  const filters = clips.map((clip, index) =>
    `[${index}:a]atrim=0:${(clip.maxDurationMs / 1000).toFixed(3)},adelay=${clip.startMs}|${clip.startMs}[v${index}]`,
  );
  filters.push(`${clips.map((_, index) => `[v${index}]`).join('')}amix=inputs=${clips.length}:duration=longest:normalize=0,aresample=async=1[voice]`);
  await Bun.write(filterPath, filters.join(';\n'));
  const voiceTrack = join(workDir, 'voice-vi.wav');
  await run('ffmpeg', [
    '-y', ...clips.flatMap((clip) => ['-i', clip.filePath]), '-filter_complex_script', filterPath,
    '-map', '[voice]', '-c:a', 'pcm_s16le', voiceTrack,
  ], 'Không thể ghép các câu thoại AI');

  assertNotCancelled(db, jobId);
  updateJob(db, jobId, { progress: 72 });
  const outputName = `video-vietsub-${Date.now()}-${randomUUID()}.mp4`;
  const outputPath = join(UPLOAD_DIR, 'renders', outputName);
  
  // Watermark logo + Subtitle combined video filter
  const logoText = options.watermarkText || 'Sleiz Vietsub';
  const logoFilter = `drawtext=text='${logoText}':x=w-tw-30:y=30:fontsize=28:fontcolor=white:bordercolor=black:borderw=2:alpha=0.9`;
  const subtitleFilter = `ass='${escapeFilterPath(assPath)}'`;
  const combinedVideoFilter = `[0:v]${logoFilter}[vlogo];[vlogo]${subtitleFilter}[vout]`;

  const bgVol = (options.bgVolume ?? 0.12).toFixed(2);
  const audioMode = options.audioMode === 'replace' ? 'replace' : 'duck';
  const renderArgs = audioMode === 'replace'
    ? ['-y', '-i', sourceVideo, '-i', voiceTrack, '-filter_complex', combinedVideoFilter, '-map', '[vout]', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-shortest', outputPath]
    : ['-y', '-i', sourceVideo, '-i', voiceTrack, '-filter_complex', `[0:a]volume=${bgVol}[orig];[orig][1:a]amix=inputs=2:duration=first:normalize=0[aout];${combinedVideoFilter}`, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', outputPath];
  await run('ffmpeg', renderArgs, 'Không thể kết xuất video hoàn chỉnh');
  await durationMs(outputPath);
  const result = {
    videoUrl: `/uploads/renders/${outputName}`,
    subtitleUrl: `/uploads/renders/${jobId}/subtitle-vi.srt`,
    voiceUrl: `/uploads/renders/${jobId}/voice-vi.wav`,
    audioMode,
    ttsEngine,
    model,
    voice,
    watermarkText: logoText,
  };
  updateJob(db, jobId, { status: 'completed', progress: 100, completedAt: now(), result: JSON.stringify(result), error: null });
}
