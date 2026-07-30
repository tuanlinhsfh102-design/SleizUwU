/**
 * @sleiz/subtitle - Subtitle parsing, conversion, and export.
 *
 * Supported formats:
 *  - SRT (SubRip)
 *  - VTT (WebVTT)
 *  - ASS / SSA (Advanced SubStation Alpha) - basic
 *  - TXT (plain text, one line per cue, no timing)
 *  - CapCut JSON (draftContent / subtitles array)
 *
 * Internal model: a normalized list of SubtitleCue objects.
 */

export type { SubtitleCue, SubtitleFormat } from '@sleiz/shared';
import type { SubtitleCue, SubtitleFormat } from '@sleiz/shared';

import { parseSrt, parseVtt, parseAss, parseTxt, parseCapcut, parseCueJson } from './parsers/index.js';
export { parseSrt, parseVtt, parseAss, parseTxt, parseCapcut, parseCueJson };
export * from './exporters/index.js';

export interface ParseResult {
  format: SubtitleFormat;
  language: string;
  cues: SubtitleCue[];
}

export interface ParseOptions {
  format?: SubtitleFormat | 'auto';
  language?: string;
}

/** Detect format from filename extension or content. */
export function detectFormat(filenameOrContent: string): SubtitleFormat {
  const lower = filenameOrContent.toLowerCase();
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.vtt')) return 'vtt';
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return 'ass';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.json') && (lower.includes('"cues"') || lower.includes('"startms"'))) return 'capcut';
  if (lower.endsWith('.json') || lower.includes('"subtitles"') || lower.includes('"tracks"')) {
    return 'capcut';
  }
  // content sniffing
  if (/webvtt/i.test(lower)) return 'vtt';
  if(/^\s*1\r?\n\d{2}:\d{2}/.test(filenameOrContent)) return 'srt';
  if(/^\[Script Info\]/i.test(filenameOrContent)) return 'ass';
  return 'srt';
}

/** Parse subtitle content into a normalized cue list. */
export async function parseSubtitle(
  content: string,
  filename: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const format = options.format && options.format !== 'auto' ? options.format : detectFormat(filename);
  const language = options.language || 'zh';

  switch (format) {
    case 'srt':
      return { format, language, cues: parseSrt(content) };
    case 'vtt':
      return { format, language, cues: parseVtt(content) };
    case 'ass':
      return { format, language, cues: parseAss(content) };
    case 'txt':
      return { format, language, cues: parseTxt(content) };
    case 'capcut': {
      const cueJson = parseCueJson(content);
      return { format, language, cues: cueJson.length ? cueJson : parseCapcut(content) };
    }
    default:
      throw new Error(`Unsupported subtitle format: ${format}`);
  }
}
