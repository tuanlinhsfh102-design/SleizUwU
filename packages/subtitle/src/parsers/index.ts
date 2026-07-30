import type { SubtitleCue } from '@sleiz/shared';
import { uuid, parseTimestamp } from '@sleiz/shared';

/** Parse Sleiz/canonical cue JSON while preserving its original timecodes. */
export function parseCueJson(content: string): SubtitleCue[] {
  const data = JSON.parse(content) as Record<string, unknown> | unknown[];
  const entries = findCueEntries(data);
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const cue = entry as Record<string, unknown>;
    const startMs = readCueTime(cue, ['startMs', 'start_ms', 'startTimeMs', 'start_time_ms'], ['start', 'startTime', 'start_time', 'from']);
    const endMs = readCueTime(cue, ['endMs', 'end_ms', 'endTimeMs', 'end_time_ms'], ['end', 'endTime', 'end_time', 'to']);
    const text = String(cue.textOriginal ?? cue.original ?? cue.text ?? cue.content ?? cue.subtitle ?? cue.caption ?? '').trim();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || !text) return [];
    return [{
      id: uuid(),
      index: 0,
      startMs: Math.floor(startMs),
      endMs: Math.floor(endMs),
      textOriginal: text,
      textTranslated: null,
      status: 'pending' as const,
    }];
  }).map((cue, index) => ({ ...cue, index }));
}

/** Locate common subtitle-array keys used by JSON exporters. */
function findCueEntries(data: Record<string, unknown> | unknown[]): unknown[] | undefined {
  if (Array.isArray(data)) return data;
  for (const key of ['cues', 'subtitles', 'segments', 'items', 'entries', 'captions']) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return undefined;
}

/** Convert JSON timing fields to milliseconds, accepting plain seconds too. */
function readCueTime(
  cue: Record<string, unknown>,
  millisecondKeys: string[],
  secondKeys: string[],
): number {
  for (const key of millisecondKeys) {
    const value = Number(cue[key]);
    if (Number.isFinite(value)) return value;
  }
  for (const key of secondKeys) {
    const raw = cue[key];
    if (typeof raw === 'string' && raw.includes(':')) return parseTimestamp(raw.replace(',', '.'));
    const value = Number(raw);
    if (Number.isFinite(value)) return value * 1000;
  }
  return Number.NaN;
}

/** Parse SRT (SubRip) format. */
export function parseSrt(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const cues: SubtitleCue[] = [];
  blocks.forEach((block, idx) => {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 2) return;

    // Optional index line (number)
    let lineIdx = 0;
    if (/^\d+$/.test(lines[0].trim())) {
      lineIdx = 1;
    }

    const timeMatch = lines[lineIdx]?.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    if (!timeMatch) return;

    const startMs = parseTimestamp(timeMatch[1]);
    const endMs = parseTimestamp(timeMatch[2]);
    const text = lines
      .slice(lineIdx + 1)
      .join('\n')
      .replace(/\{[^}]*\}/g, '') // strip ASS-style overrides
      .trim();

    cues.push({
      id: uuid(),
      index: idx,
      startMs,
      endMs,
      textOriginal: text,
      textTranslated: null,
      status: 'pending',
    });
  });

  return cues;
}

/** Parse VTT (WebVTT) format. */
export function parseVtt(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Strip header
  const body = normalized.replace(/^WEBVTT.*?\n/, '').replace(/^NOTE.*?\n\n/gs, '');

  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  const cues: SubtitleCue[] = [];
  let idx = 0;

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length < 1) continue;

    let lineIdx = 0;
    // VTT may have a cue identifier (any non-timing line)
    if (!lines[0].includes('-->')) {
      lineIdx = 1;
    }

    const timeMatch = lines[lineIdx]?.match(
      /(\d{1,2}:\d{2}:\d{2}\.\d{1,3}|\d{2}:\d{2}\.\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}\.\d{1,3}|\d{2}:\d{2}\.\d{1,3})/,
    );
    if (!timeMatch) continue;

    const startMs = parseTimestamp(timeMatch[1]);
    const endMs = parseTimestamp(timeMatch[2]);
    const text = lines
      .slice(lineIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '') // strip VTT inline tags
      .trim();

    cues.push({
      id: uuid(),
      index: idx++,
      startMs,
      endMs,
      textOriginal: text,
      textTranslated: null,
      status: 'pending',
    });
  }

  return cues;
}

/** Parse ASS / SSA format (basic - ignores styles). */
export function parseAss(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  // Find [Events] section
  const eventsIdx = lines.findIndex((l) => /^\[Events\]/i.test(l.trim()));
  if (eventsIdx === -1) return [];

  // Find Format line
  let formatFields: string[] = [];
  for (let i = eventsIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('Format:')) {
      formatFields = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
      break;
    }
    if (line.startsWith('[')) break; // next section
  }
  if (formatFields.length === 0) {
    formatFields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  }

  const startIdx = formatFields.indexOf('start');
  const endIdx = formatFields.indexOf('end');
  const textIdx = formatFields.indexOf('text');
  const nameIdx = formatFields.indexOf('name');

  if (startIdx === -1 || endIdx === -1 || textIdx === -1) return [];

  const cues: SubtitleCue[] = [];
  let idx = 0;

  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice(9).split(',');
    // text may contain commas - rejoin everything after textIdx
    const fixed = parts.slice(0, textIdx);
    const text = parts.slice(textIdx).join(',');
    fixed.push(text);

    const startMs = parseTimestamp(fixed[startIdx] || '0:0:0.0');
    const endMs = parseTimestamp(fixed[endIdx] || '0:0:0.0');
    const speaker = nameIdx >= 0 ? fixed[nameIdx]?.trim() || undefined : undefined;
    const cleanText = text
      .replace(/\{[^}]*\}/g, '') // strip ASS overrides
      .replace(/\\N/gi, '\n')
      .replace(/\\n/gi, '\n')
      .replace(/\\h/gi, ' ')
      .trim();

    if (!cleanText) continue;

    cues.push({
      id: uuid(),
      index: idx++,
      startMs,
      endMs,
      textOriginal: cleanText,
      textTranslated: null,
      status: 'pending',
      speaker: speaker || null,
    });
  }

  return cues;
}

/** Parse plain text - one cue per line, no timing (will need manual timing). */
export function parseTxt(content: string): SubtitleCue[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((text, idx) => ({
    id: uuid(),
    index: idx,
    startMs: idx * 3000,
    endMs: idx * 3000 + 2500,
    textOriginal: text,
    textTranslated: null,
    status: 'pending',
  }));
}

/** Parse CapCut JSON (draft content or simple subtitles array). */
export function parseCapcut(content: string): SubtitleCue[] {
  const data = JSON.parse(content);
  const cues: SubtitleCue[] = [];
  let idx = 0;

  // CapCut draft format: materials.texts[].content -> JSON with text + time
  // Also support simpler format: { subtitles: [{start, end, text}] }
  if (Array.isArray(data.subtitles)) {
    for (const sub of data.subtitles) {
      cues.push({
        id: uuid(),
        index: idx++,
        startMs: Math.floor((sub.start || 0) * 1000),
        endMs: Math.floor((sub.end || sub.start || 0) * 1000),
        textOriginal: String(sub.text || '').trim(),
        textTranslated: null,
        status: 'pending',
      });
    }
    return cues;
  }

  // CapCut draft: materials.texts[]
  const texts = data?.materials?.texts;
  if (Array.isArray(texts)) {
    for (const t of texts) {
      // In a CapCut draft, text material commonly contains only the text.
      // Its actual placement is stored in tracks[].segments[].target_timerange.
      // Do not create a zero-length cue here when the material has no timing:
      // that placeholder used to win deduplication and discard the real cue.
      const hasTiming = typeof t.start_time === 'number' || typeof t.end_time === 'number';
      if (!hasTiming) continue;
      let text = '';
      try {
        const content = JSON.parse(t.content || '{}');
        text = content.text || '';
      } catch {
        text = String(t.content || '').replace(/<[^>]+>/g, '');
      }
      if (!text) continue;
      cues.push({
        id: uuid(),
        index: idx++,
        startMs: Math.floor((t.start_time || 0) * 1_000_000) / 1000,
        endMs: Math.floor((t.end_time || t.start_time || 0) * 1_000_000) / 1000,
        textOriginal: text.replace(/<[^>]+>/g, ''),
        textTranslated: null,
        status: 'pending',
      });
    }
  }

  // CapCut can also expose tracks[].segments with target_timerange
  const tracks = data?.tracks;
  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      const segments = track?.segments;
      if (!Array.isArray(segments)) continue;
      for (const seg of segments) {
        const target = seg.target_timerange;
        if (!target) continue;
        const materialId = seg.material_id;
        const material = data?.materials?.texts?.find((m: { id: string }) => m.id === materialId);
        if (!material) continue;
        let text = '';
        try {
          text = JSON.parse(material.content || '{}').text || '';
        } catch {
          text = String(material.content || '').replace(/<[^>]+>/g, '');
        }
        if (!text) continue;
        cues.push({
          id: uuid(),
          index: idx++,
          startMs: Math.floor(target.start / 1000),
          endMs: Math.floor((target.start + target.duration) / 1000),
          textOriginal: text.replace(/<[^>]+>/g, ''),
          textTranslated: null,
          status: 'pending',
        });
      }
    }
  }

  // Deduplicate by startMs (CapCut often duplicates text materials across tracks)
  const seen = new Set<number>();
  return cues.filter((c) => {
    if (seen.has(c.startMs)) return false;
    seen.add(c.startMs);
    return true;
  }).map((cue, index) => ({ ...cue, index }));
}
