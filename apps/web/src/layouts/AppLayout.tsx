import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { StatusBar } from '../components/StatusBar';
import { CommandPalette } from '../components/CommandPalette';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

export function AppLayout() {
  // Subscribe to Supabase Realtime Broadcast — invalidates TanStack Query
  // caches when the API server pushes change events. Safe to mount globally;
  // it no-ops when Supabase is not configured (falls back to polling).
  useRealtimeSync();

  return (
    <div className="flex h-screen flex-col bg-[#0b0b0d] text-zinc-100 overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
