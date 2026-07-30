/**
 * Routes for polling download progress.
 *
 * The download clients (TikTok / Bilibili) push real-time progress to the
 * `progressBroker`. The webview polls `GET /api/downloads/:jobId/status` while
 * a download is in flight so it can render a real progress bar instead of an
 * indefinite spinner.
 */
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { progressBroker } from '../services/download-progress.js';

export const downloadsRouter = new Hono<Env>();

downloadsRouter.get('/:jobId/status', (c) => {
  const jobId = c.req.param('jobId');
  if (!jobId) return c.json({ error: 'ValidationError', message: 'jobId is required' }, 400);
  const entry = progressBroker.get(jobId);
  if (!entry) {
    // Either never existed or was GC'd. 404 lets the UI stop polling gracefully.
    return c.json({ data: null, notFound: true }, 404);
  }
  return c.json({ data: entry });
});

/**
 * Server-Sent Events stream for a single job. Browsers consume this via
 * `EventSource`; it pushes one `progress` event per broker update, then closes
 * the stream when the job reaches a terminal state. This is an alternative to
 * polling — useful if you want sub-second updates without hammering the API.
 */
downloadsRouter.get('/:jobId/events', (c) => {
  const jobId = c.req.param('jobId');
  if (!jobId) return c.json({ error: 'ValidationError', message: 'jobId is required' }, 400);

  const stream = new ReadableStream({
    start: (controller) => {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(enc.encode(payload));
        } catch {
          /* stream closed */
        }
      };

      const current = progressBroker.get(jobId);
      if (current) {
        send('progress', current);
        if (current.status === 'completed' || current.status === 'error') {
          controller.close();
          return;
        }
      }

      const unsubscribe = progressBroker.on(jobId, (p) => {
        send('progress', p);
        if (p.status === 'completed' || p.status === 'error') {
          unsubscribe();
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
