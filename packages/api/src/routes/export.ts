import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { exportSrt, exportVtt, exportAss, exportTxt, exportJson } from '@sleiz/subtitle';
import type { SubtitleCue } from '@sleiz/shared';
import type { Env } from '../index.js';
import { addHistory } from '../services/history.js';

export const exportRouter = new Hono<Env>();

exportRouter.post('/subtitle', async (c) => {
  const db = c.get('db') as DB;
  const body = await c.req.json();
  const { subtitleId, format, preferTranslated = true, translatedOnly = false } = body as {
    subtitleId: string;
    format: 'srt' | 'vtt' | 'ass' | 'txt' | 'json';
    preferTranslated?: boolean;
    translatedOnly?: boolean;
  };
  if (!subtitleId || !format) {
    return c.json({ error: 'ValidationError', message: 'subtitleId and format are required' }, 400);
  }
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!sub) return c.json({ error: 'NotFound' }, 404);
  const cues = JSON.parse(sub.cues) as SubtitleCue[];

  let content: string;
  let mimeType: string;
  let extension: string;
  switch (format) {
    case 'srt':
      content = exportSrt(cues, { preferTranslated, translatedOnly });
      mimeType = 'application/x-subrip';
      extension = 'srt';
      break;
    case 'vtt':
      content = exportVtt(cues, { preferTranslated });
      mimeType = 'text/vtt';
      extension = 'vtt';
      break;
    case 'ass':
      content = exportAss(cues, { preferTranslated });
      mimeType = 'text/plain';
      extension = 'ass';
      break;
    case 'txt':
      content = exportTxt(cues, { preferTranslated });
      mimeType = 'text/plain';
      extension = 'txt';
      break;
    case 'json':
      content = exportJson(cues, { preferTranslated });
      mimeType = 'application/json';
      extension = 'json';
      break;
    default:
      return c.json({ error: 'ValidationError', message: `Unsupported format: ${format}` }, 400);
  }

  await addHistory(db, {
    action: 'export',
    entityType: 'subtitle',
    entityId: subtitleId,
    details: `Exported as ${format.toUpperCase()} (${cues.length} cues)`,
  });

  // Return both content and metadata so the frontend can trigger a download.
  const filename = `subtitle-${subtitleId.slice(0, 8)}.${extension}`;
  return c.json({
    data: {
      content,
      filename,
      mimeType,
      format,
      cueCount: cues.length,
    },
  });
});
