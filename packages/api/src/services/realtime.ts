/**
 * @sleiz/api / services / realtime
 *
 * Thin wrapper around Supabase Realtime Broadcast. The API server uses the
 * service-role key to publish `RealtimeEvent` messages on the
 * `sleiz:realtime` channel; all connected web/desktop clients subscribe to
 * the same channel and invalidate their TanStack Query caches accordingly.
 *
 * Design goals:
 *  - **Zero-downtime**: if Supabase env vars are missing or the network is
 *    down, broadcasts silently no-op. The app keeps working via polling.
 *  - **Fire-and-forget**: callers never `await` the broadcast — it must not
 *    slow down a request path.
 *  - **Self-healing**: the Supabase client is created lazily and recreated
 *    if the underlying socket dies.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { REALTIME_CHANNEL_NAME, type RealtimeEntity, type RealtimeOp } from '@sleiz/shared';

let client: SupabaseClient | null = null;
let clientUrl: string | null = null;
let channel: ReturnType<SupabaseClient['channel']> | null = null;
let channelReady: Promise<void> | null = null;
let disabled = false;

/**
 * Lazily build (and memoise) the Supabase client. Returns `null` when the env
 * vars are missing or obviously malformed — callers should treat that as
 * "realtime disabled" and skip the broadcast.
 */
function getClient(): SupabaseClient | null {
  if (disabled) return null;
  if (client && clientUrl === process.env.SUPABASE_URL) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key || url.includes('YOUR-PROJECT') || key.startsWith('your-')) {
    // Don't log on every call — only once per process.
    if (!disabled) {
      console.warn('[realtime] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — broadcasting disabled.');
      disabled = true;
    }
    return null;
  }

  try {
    client = createClient(url, key, {
      realtime: {
        params: { eventsPerSecond: 20 },
      },
      // The server only broadcasts — never queries the DB — so we can skip
      // auth/persistence overhead.
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientUrl = url;
    console.log(`[realtime] client initialised → ${url}`);
    return client;
  } catch (err) {
    console.warn('[realtime] failed to init Supabase client:', err);
    disabled = true;
    return null;
  }
}

/**
 * Broadcast a change event to all subscribers. Never throws.
 *
 * @example
 *   broadcast('channels', 'create', channel.id);
 *   broadcast('batches', 'progress', batch.id, { progress: { done: 5, total: 10 } });
 */
export function broadcast(
  entity: RealtimeEntity,
  op: RealtimeOp,
  id?: string,
  extra?: {
    scope?: {
      channelId?: string;
      movieId?: string;
      episodeId?: string;
      subtitleId?: string;
      jobId?: string;
    };
    progress?: { done: number; total: number; failed?: number; status?: string; percent?: number };
  },
): void {
  const supa = getClient();
  if (!supa) return;

  const payload = {
    type: 'broadcast',
    event: 'change',
    payload: {
      ts: Date.now(),
      entity,
      op,
      id,
      scope: extra?.scope,
      progress: extra?.progress,
    },
  };

  try {
    // A Broadcast must be sent through a subscribed channel. Reusing the
    // channel also prevents a new websocket/channel from being leaked per API
    // mutation.
    if (!channel) {
      channel = supa.channel(REALTIME_CHANNEL_NAME);
      channelReady = new Promise((resolve) => {
        channel!.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
      });
    }
    void channelReady.then(() => channel!.send(payload as any)).catch((err) => {
      if (process.env.REALTIME_DEBUG === '1') {
        console.warn('[realtime] broadcast error:', err);
      }
    });
  } catch (err) {
    if (process.env.REALTIME_DEBUG === '1') {
      console.warn('[realtime] broadcast threw:', err);
    }
  }
}

/** Convenience helpers — saves callers from importing the type literal. */
export const rt = {
  created: (entity: RealtimeEntity, id?: string, scope?: Parameters<typeof broadcast>[3]['scope']) =>
    broadcast(entity, 'create', id, { scope }),
  updated: (entity: RealtimeEntity, id?: string, scope?: Parameters<typeof broadcast>[3]['scope']) =>
    broadcast(entity, 'update', id, { scope }),
  deleted: (entity: RealtimeEntity, id?: string, scope?: Parameters<typeof broadcast>[3]['scope']) =>
    broadcast(entity, 'delete', id, { scope }),
  progress: (
    entity: RealtimeEntity,
    id: string | undefined,
    progress: { done: number; total: number; failed?: number; status?: string; percent?: number },
    scope?: Parameters<typeof broadcast>[3]['scope'],
  ) => broadcast(entity, 'progress', id, { progress, scope }),
  cleared: (entity: RealtimeEntity) => broadcast(entity, 'clear'),
};

/** Test-only: force-reset the singleton (used by self-tests). */
export function _resetRealtimeForTests(): void {
  if (client && channel) void client.removeChannel(channel);
  client = null;
  clientUrl = null;
  channel = null;
  channelReady = null;
  disabled = false;
}

/** Returns true when Supabase realtime is configured (used by /api/health). */
export function isRealtimeConfigured(): boolean {
  return getClient() !== null;
}
