/**
 * Browser-side Supabase client (singleton).
 *
 * Reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from env. Returns
 * `null` when not configured so callers can fall back to polling — the app
 * must keep working in pure-local mode (e.g. offline desktop builds).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: { url: string; client: SupabaseClient } | null = null;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached.client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key || url.includes('YOUR-PROJECT') || key.startsWith('your-')) {
    return null;
  }

  try {
    const client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: 20 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cached = { url, client };
    return client;
  } catch (err) {
    console.warn('[realtime] failed to init Supabase client:', err);
    return null;
  }
}

/** True when Supabase realtime is configured — used by the StatusBar indicator. */
export function isRealtimeConfigured(): boolean {
  return getSupabase() !== null;
}
