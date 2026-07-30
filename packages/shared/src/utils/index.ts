/**
 * Shared utility functions used across the entire app.
 */

/** Generate a UUID v4 (Bun / browser compatible). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Create a URL-friendly slug from a Vietnamese / Chinese string. */
export function slugify(input: string): string {
  return input
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Format milliseconds as HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT). */
export function formatTimestamp(ms: number, format: 'srt' | 'vtt' = 'srt'): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  const sep = format === 'srt' ? ',' : '.';
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${sep}${pad(millis, 3)}`;
}

/** Parse SRT/VTT timestamp into milliseconds. */
export function parseTimestamp(ts: string): number {
  const cleaned = ts.replace(',', '.').trim();
  const match = cleaned.match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return (
    (Number(h || 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number((ms || '0').padEnd(3, '0'))
  );
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

/** Format a number as a compact currency string. */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a token count with thousand separators. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format duration (ms) as "1 phút 23 giây" / "1 giờ 5 phút". */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút ${s % 60} giây`;
  const h = Math.floor(m / 60);
  return `${h} giờ ${m % 60} phút`;
}

/** Compute ETA from processed / total / elapsed ms. */
export function computeEta(processed: number, total: number, elapsedMs: number): number {
  if (processed <= 0) return 0;
  const rate = processed / elapsedMs;
  return Math.max(0, (total - processed) / rate);
}

/** SHA-256 hash a string. Works in Bun and modern browsers. */
export async function hashString(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: simple FNV hash
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Rough token estimate (4 chars ~= 1 token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Clamp a number between min and max. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Format a Date as relative Vietnamese time, or absolute date. */
export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'vừa xong';
  if (s < 60) return `${s} giây trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} ngày trước`;
  return d.toLocaleDateString('vi-VN');
}

/** Truncate text with ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/** Type-safe Object.entries. */
export function entries<T extends object>(o: T): [keyof T, T[keyof T]][] {
  return Object.entries(o) as [keyof T, T[keyof T]][];
}

/** Type-safe Object.keys. */
export function keys<T extends object>(o: T): (keyof T)[] {
  return Object.keys(o) as (keyof T)[];
}

/** Pick a value from a record by key with a fallback. */
export function pick<T extends Record<string, unknown>>(o: T, k: string, fallback: unknown = null): unknown {
  return k in o ? o[k] : fallback;
}

/** Debounce a function. */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 200): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  }) as T;
}

/** Conditional className joiner. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
