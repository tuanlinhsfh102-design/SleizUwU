/**
 * In-memory progress broker for video downloads.
 *
 * The download routes (TikTok / Bilibili) update progress here as bytes are
 * received; the frontend polls `GET /api/downloads/:jobId/status` every ~500ms
 * to drive the progress bar. Entries are GC'd shortly after completion so the
 * map doesn't grow unbounded.
 */
import { EventEmitter } from 'node:events';
import { rt } from '../services/realtime.js';

export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'error';

export interface DownloadProgress {
  jobId: string;
  source: 'tiktok' | 'bilibili';
  kind: 'video' | 'music';
  filename: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number; // 0 if Content-Length is unknown
  percent: number; // 0..100
  speedBps: number; // average bytes/sec since the job started
  startedAt: number; // epoch ms
  updatedAt: number; // epoch ms
  error?: string;
  // Final result once status === 'completed'
  filePath?: string;
  fileSize?: number;
  durationMs?: number;
  mimeType?: string;
  from?: string;
}

export interface ProgressListenerPayload extends DownloadProgress {}

const TTL_MS = 5 * 60 * 1000; // keep completed jobs around for 5 minutes
const GC_INTERVAL_MS = 60 * 1000;

class DownloadProgressBroker {
  private readonly jobs = new Map<string, DownloadProgress>();
  private readonly bus = new EventEmitter();
  private gcTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.bus.setMaxListeners(200);
    if (!this.gcTimer) {
      this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
      // Don't keep the event loop alive just for GC.
      this.gcTimer.unref?.();
    }
  }

  start(p: Omit<DownloadProgress, 'status' | 'percent' | 'speedBps' | 'updatedAt'> & {
    status?: DownloadStatus;
  }): DownloadProgress {
    const now = Date.now();
    const entry: DownloadProgress = {
      ...p,
      status: p.status ?? 'queued',
      percent: 0,
      speedBps: 0,
      updatedAt: now,
    };
    this.jobs.set(p.jobId, entry);
    this.emit(entry);
    return entry;
  }

  update(
    jobId: string,
    patch: Partial<Pick<DownloadProgress, 'status' | 'receivedBytes' | 'totalBytes' | 'percent' | 'speedBps' | 'error' | 'filePath' | 'fileSize' | 'durationMs' | 'mimeType' | 'from'>>,
  ): DownloadProgress | null {
    const cur = this.jobs.get(jobId);
    if (!cur) return null;
    const next: DownloadProgress = {
      ...cur,
      ...patch,
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, next);
    this.emit(next);
    return next;
  }

  /** Mark a job as successfully completed and freeze its final state. */
  complete(
    jobId: string,
    result: Pick<DownloadProgress, 'filePath' | 'fileSize' | 'durationMs' | 'mimeType' | 'from'>,
  ): DownloadProgress | null {
    return this.update(jobId, {
      status: 'completed',
      percent: 100,
      receivedBytes: result.fileSize,
      totalBytes: result.fileSize,
      filePath: result.filePath,
      fileSize: result.fileSize,
      durationMs: result.durationMs,
      mimeType: result.mimeType,
      from: result.from,
    });
  }

  fail(jobId: string, message: string): DownloadProgress | null {
    return this.update(jobId, { status: 'error', error: message });
  }

  get(jobId: string): DownloadProgress | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** Subscribe to a specific job's progress events. Returns an unsubscribe fn. */
  on(jobId: string, handler: (p: DownloadProgress) => void): () => void {
    const evt = `progress:${jobId}`;
    this.bus.on(evt, handler);
    return () => this.bus.off(evt, handler);
  }

  private emit(p: DownloadProgress): void {
    this.bus.emit(`progress:${p.jobId}`, p);
    // Push to Supabase Realtime so all web/desktop clients can update their
    // progress bars instantly (replaces 600ms polling on the frontend).
    rt.progress(
      'downloads',
      p.jobId,
      { done: p.receivedBytes, total: p.totalBytes || 0, percent: p.percent, status: p.status },
      { jobId: p.jobId },
    );
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, p] of this.jobs) {
      const terminal = p.status === 'completed' || p.status === 'error';
      if (terminal && now - p.updatedAt > TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  /** For tests / debug only. */
  size(): number {
    return this.jobs.size;
  }
}

// Process-wide singleton; both the Hono app and the Bun main process share it.
export const progressBroker = new DownloadProgressBroker();

/**
 * Helper for clients: throttle progress callbacks so we don't spam the broker
 * (and the React UI) more than ~4x/sec. We always emit the final 100% update.
 */
export function makeThrottledReporter(
  jobId: string,
  minIntervalMs = 250,
): (p: { receivedBytes: number; totalBytes: number; percent: number; speedBps: number }) => void {
  let last = 0;
  return (p) => {
    const now = Date.now();
    const isFinal = p.percent >= 100;
    if (isFinal || now - last >= minIntervalMs) {
      last = now;
      progressBroker.update(jobId, p);
    }
  };
}
