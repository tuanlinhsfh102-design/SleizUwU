import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context) {
  console.error('[API ERROR]', err);
  return c.json(
    {
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected error occurred',
    },
    500,
  );
}

/** Wrap an async route handler so thrown errors fall through to onError. */
export function safe<T>(fn: (c: Context) => Promise<T>) {
  return async (c: Context) => {
    try {
      return await fn(c);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  };
}
