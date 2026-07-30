import type { SubtitleCue } from '@sleiz/shared';
import { formatTimestamp } from '@sleiz/shared';

export interface ExportOptions {
  /** Use translated text if available, otherwise original. */
  preferTranslated?: boolean;
  /** Require a translation for every cue instead of falling back to source text. */
  translatedOnly?: boolean;
  /** CapCut-style JSON output. */
  pretty?: boolean;
}

/** Export cues to SRT. */
export function exportSrt(cues: SubtitleCue[], opts: ExportOptions = {}): string {
  if (opts.translatedOnly) {
    const missing = cues.find((cue) => !cue.textTranslated?.trim());
    if (missing) throw new Error(`Không thể xuất SRT tiếng Việt: dòng ${missing.index + 1} chưa được dịch.`);
  }
  const out: string[] = [];
  cues.forEach((cue, idx) => {
    const text = (opts.preferTranslated !== false ? cue.textTranslated : null) || cue.textOriginal;
    if (!text?.trim()) return;
    out.push(String(idx + 1));
    out.push(`${formatTimestamp(cue.startMs, 'srt')} --> ${formatTimestamp(cue.endMs, 'srt')}`);
    out.push(text);
    out.push('');
  });
  return out.join('\n');
}

/** Export cues to VTT. */
export function exportVtt(cues: SubtitleCue[], opts: ExportOptions = {}): string {
  const out: string[] = ['WEBVTT', ''];
  cues.forEach((cue) => {
    const text = (opts.preferTranslated !== false ? cue.textTranslated : null) || cue.textOriginal;
    if (!text?.trim()) return;
    out.push(`${formatTimestamp(cue.startMs, 'vtt')} --> ${formatTimestamp(cue.endMs, 'vtt')}`);
    out.push(text);
    out.push('');
  });
  return out.join('\n');
}

/** Export cues to ASS (basic - Default style only). */
export function exportAss(cues: SubtitleCue[], opts: ExportOptions = {}): string {
  const header = `[Script Info]
Title: Sleiz Studio Export
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default, Arial, 72, &H00FFFFFF, &H000000FF, &H00000000, &H80000000, 0, 0, 0, 0, 100, 100, 0, 0, 1, 3, 1, 2, 60, 60, 60, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [header];
  for (const cue of cues) {
    const text = (opts.preferTranslated !== false ? cue.textTranslated : null) || cue.textOriginal;
    if (!text?.trim()) continue;
    const start = formatAssTime(cue.startMs);
    const end = formatAssTime(cue.endMs);
    const escaped = text.replace(/\n/g, '\\N');
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${escaped}`);
  }
  return lines.join('\n');
}

function formatAssTime(ms: number): string {
  const total = Math.floor(ms / 10); // centiseconds
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Export to plain text (original or translated, one per line). */
export function exportTxt(cues: SubtitleCue[], opts: ExportOptions = {}): string {
  const lines: string[] = [];
  for (const cue of cues) {
    const text = (opts.preferTranslated !== false ? cue.textTranslated : null) || cue.textOriginal;
    if (!text?.trim()) continue;
    lines.push(text);
  }
  return lines.join('\n');
}

/** Export to JSON (full cue data). */
export function exportJson(cues: SubtitleCue[], opts: ExportOptions = {}): string {
  const data = {
    format: 'sleiz-subtitle',
    version: 1,
    exportedAt: new Date().toISOString(),
    preferTranslated: opts.preferTranslated !== false,
    cues: cues.map((c) => ({
      index: c.index,
      startMs: c.startMs,
      endMs: c.endMs,
      start: formatTimestamp(c.startMs, 'srt'),
      end: formatTimestamp(c.endMs, 'srt'),
      original: c.textOriginal,
      translated: c.textTranslated,
      speaker: c.speaker,
    })),
  };
  return JSON.stringify(data, null, opts.pretty === false ? 0 : 2);
}
