/**
 * useRealtimeSync — subscribes to the Supabase Realtime Broadcast channel
 * pushed by the API server and invalidates the matching TanStack Query keys.
 *
 * Mount this once at the app root (e.g. inside AppLayout). When Supabase is
 * not configured, it no-ops — the existing polling in `useJobs`, `useBatches`,
 * etc. continues to keep the UI fresh.
 *
 * Also exposes the live connection state via a Zustand store so the
 * StatusBar can render a "Realtime: connected / connecting / offline" chip.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  REALTIME_CHANNEL_NAME,
  REALTIME_QUERY_MAP,
  type RealtimeEvent,
} from '@sleiz/shared';
import { getSupabase } from '../lib/supabase';

export type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'error';
const RETRYABLE_STATES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);
const RECONNECT_DELAY_MS = 5_000;

interface RealtimeState {
  status: RealtimeStatus;
  lastEventAt: number | null;
  eventsReceived: number;
  lastError: string | null;
  setStatus: (s: RealtimeState['status']) => void;
  registerEvent: () => void;
  setError: (e: string | null) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'off',
  lastEventAt: null,
  eventsReceived: 0,
  lastError: null,
  setStatus: (status) => set({ status }),
  registerEvent: () =>
    set((s) => ({
      eventsReceived: s.eventsReceived + 1,
      lastEventAt: Date.now(),
      status: 'connected',
    })),
  // Clearing an old error after a successful subscription must not turn the
  // connection back into an error state.
  setError: (lastError) => set((state) => ({
    lastError,
    status: lastError ? 'error' : state.status,
  })),
}));

/**
 * Subscribe to the global realtime channel and invalidate queries on change.
 * Returns nothing — it's a hook meant to be mounted at the app root.
 */
export function useRealtimeSync(): void {
  const qc = useQueryClient();
  const setStatus = useRealtimeStore((s) => s.setStatus);
  const registerEvent = useRealtimeStore((s) => s.registerEvent);
  const setError = useRealtimeStore((s) => s.setError);

  useEffect(() => {
    const supa = getSupabase();
    if (!supa) {
      setStatus('off');
      return;
    }

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supa.channel> | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');
      channel = supa.channel(REALTIME_CHANNEL_NAME);

      channel.on('broadcast', { event: 'change' }, (msg: unknown) => {
        try {
          const payload = (msg as { payload?: RealtimeEvent }).payload;
          if (!payload || !payload.entity) return;
          registerEvent();

          const keys = REALTIME_QUERY_MAP[payload.entity] || [];
          // Invalidate the broad key — TanStack will refetch affected queries.
          for (const k of keys) {
            qc.invalidateQueries({ queryKey: [k] });
          }

          // For progress events on a specific job/subtitle, also invalidate
          // the keyed variants (e.g. ['subtitle-translate-status', subId]).
          if (payload.op === 'progress' && payload.scope?.subtitleId) {
            qc.invalidateQueries({
              queryKey: ['subtitle-translate-status', payload.scope.subtitleId],
            });
          }
          if (payload.op === 'progress' && payload.scope?.jobId) {
            qc.invalidateQueries({
              queryKey: ['download-status', payload.scope.jobId],
            });
          }
        } catch (err) {
          console.warn('[realtime] handler error:', err);
        }
      });

      channel.subscribe((state: string, error?: Error) => {
        if (disposed) return;
        if (state === 'SUBSCRIBED') {
          setStatus('connected');
          setError(null);
          return;
        }
        if (RETRYABLE_STATES.has(state)) {
          setError(error?.message || state);
          // Supabase Realtime handles many reconnects itself, but explicitly
          // recreating a closed/error channel keeps the indicator recoverable.
          void supa.removeChannel(channel!);
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        if (channel) void supa.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [qc, setStatus, registerEvent, setError]);
}

/**
 * Convenience selector for components that only want to display the status.
 */
export function useRealtimeStatus(): RealtimeStatus {
  return useRealtimeStore((s) => s.status);
}
