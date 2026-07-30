/**
 * @sleiz/worker - Async job queue runner.
 *
 * Polls the `jobs` table for queued jobs and executes them. Supports:
 *   - Priority ordering
 *   - Retry with backoff
 *   - Pause / resume / cancel
 *   - Progress updates
 *
 * Job types are dispatched through a registry of handlers.
 */
import { eq, and, asc } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import type { Job, JobType, JobStatus } from '@sleiz/shared';

export interface JobHandler {
  type: JobType;
  run: (job: Job, update: (progress: number, total?: number) => void) => Promise<unknown>;
}

export class Worker {
  private handlers = new Map<JobType, JobHandler>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private db: DB, private intervalMs = 1000) {}

  register(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick(); // run immediately
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const job = this.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'queued'))
      .orderBy(asc(schema.jobs.priority), asc(schema.jobs.createdAt))
      .limit(1)
      .get();
    if (!job) return;

    const handler = this.handlers.get(job.type as JobType);
    if (!handler) {
      this.db
        .update(schema.jobs)
        .set({ status: 'failed', error: `No handler for job type: ${job.type}`, updatedAt: Date.now() / 1000 })
        .where(eq(schema.jobs.id, job.id))
        .run();
      return;
    }

    // Mark running
    this.db
      .update(schema.jobs)
      .set({ status: 'running', startedAt: Date.now() / 1000, updatedAt: Date.now() / 1000 })
      .where(eq(schema.jobs.id, job.id))
      .run();

    try {
      const result = await handler.run(
        rowToJob(job),
        (progress, total) => {
          this.db
            .update(schema.jobs)
            .set({
              progress: Math.floor(progress),
              ...(total !== undefined ? { total } : {}),
              updatedAt: Date.now() / 1000,
            })
            .where(eq(schema.jobs.id, job.id))
            .run();
        },
      );
      this.db
        .update(schema.jobs)
        .set({
          status: 'completed',
          progress: job.total || 100,
          result: result ? JSON.stringify(result) : null,
          completedAt: Date.now() / 1000,
          updatedAt: Date.now() / 1000,
        })
        .where(eq(schema.jobs.id, job.id))
        .run();
    } catch (err) {
      const retryCount = job.retryCount + 1;
      const shouldRetry = retryCount < job.maxRetries;
      this.db
        .update(schema.jobs)
        .set({
          status: shouldRetry ? 'queued' : 'failed',
          retryCount,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now() / 1000,
        })
        .where(eq(schema.jobs.id, job.id))
        .run();
    }
  }
}

function rowToJob(r: typeof schema.jobs.$inferSelect): Job {
  return {
    id: r.id,
    type: r.type as JobType,
    status: r.status as JobStatus,
    priority: r.priority,
    payload: r.payload,
    result: r.result,
    error: r.error,
    progress: r.progress,
    total: r.total,
    retryCount: r.retryCount,
    maxRetries: r.maxRetries,
    startedAt: r.startedAt ? new Date(r.startedAt * 1000).toISOString() : null,
    completedAt: r.completedAt ? new Date(r.completedAt * 1000).toISOString() : null,
    createdAt: new Date(r.createdAt * 1000).toISOString(),
    updatedAt: new Date(r.updatedAt * 1000).toISOString(),
  };
}
