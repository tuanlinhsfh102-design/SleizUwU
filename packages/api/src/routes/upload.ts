import { Hono } from 'hono';
import { mkdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import type { Env } from '../index.js';

export const uploadRouter = new Hono<Env>();

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

if (!existsSync(UPLOAD_DIR)) {
  try { mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
}

function cleanExt(ext: string): string {
  const e = ext.toLowerCase();
  return ALLOWED_EXT.includes(e) ? e : '.jpg';
}

uploadRouter.post('/', async (c) => {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return c.json({ error: 'ValidationError', message: 'Content-Type phải là multipart/form-data' }, 400);
  }
  let fileName: string | null = null;
  let storedName: string | null = null;
  try {
    const form = await c.req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return c.json({ error: 'ValidationError', message: 'Thiếu file upload (field name: "file")' }, 400);
    }
    if (file.size > MAX_SIZE) {
      return c.json({ error: 'ValidationError', message: `File quá lớn (tối đa ${MAX_SIZE / 1024 / 1024}MB)` }, 413);
    }
    const originalName = file.name || 'upload';
    fileName = originalName;
    const ext = cleanExt(extname(originalName) || '.jpg');
    storedName = `${randomUUID()}${ext}`;
    const fullPath = join(UPLOAD_DIR, storedName);
    const buf = Buffer.from(await file.arrayBuffer());
    await Bun.write(fullPath, buf);
    return c.json({
      ok: true,
      data: {
        url: `/uploads/${storedName}`,
        fileName,
        storedName,
        size: file.size,
        ext,
      },
    }, 201);
  } catch (err) {
    return c.json({
      error: 'UploadError',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

uploadRouter.get('/:filename', async (c) => {
  const name = c.req.param('filename');
  const safe = name.replace(/[^a-zA-Z0-9._\-]/g, '');
  const fullPath = join(UPLOAD_DIR, safe);
  if (!existsSync(fullPath)) return c.json({ error: 'NotFound' }, 404);
  const file = Bun.file(fullPath);
  return new Response(file, {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

export { UPLOAD_DIR };
