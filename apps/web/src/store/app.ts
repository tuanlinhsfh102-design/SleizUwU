/**
 * Global UI / app state (Zustand).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SidebarId } from '@sleiz/shared';

interface AppState {
  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  // Active channel filter (drives Movies / Episodes pages)
  activeChannelId: string | null;
  setActiveChannel: (id: string | null) => void;

  // Active movie filter (drives Episodes page)
  activeMovieId: string | null;
  setActiveMovie: (id: string | null) => void;

  // Active episode (drives Subtitle / Video / AI pages)
  activeEpisodeId: string | null;
  setActiveEpisode: (id: string | null) => void;

  // Active subtitle (drives Subtitle Editor / Export)
  activeSubtitleId: string | null;
  setActiveSubtitle: (id: string | null) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;

  // Status bar
  statusBarMessage: string | null;
  setStatusBarMessage: (m: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      activeChannelId: null,
      setActiveChannel: (id) => set({ activeChannelId: id, activeMovieId: null, activeEpisodeId: null, activeSubtitleId: null }),

      activeMovieId: null,
      setActiveMovie: (id) => set({ activeMovieId: id, activeEpisodeId: null, activeSubtitleId: null }),

      activeEpisodeId: null,
      setActiveEpisode: (id) => set({ activeEpisodeId: id, activeSubtitleId: null }),

      activeSubtitleId: null,
      setActiveSubtitle: (id) => set({ activeSubtitleId: id }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),

      statusBarMessage: null,
      setStatusBarMessage: (m) => set({ statusBarMessage: m }),
    }),
    {
      name: 'sleiz:app-store',
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        activeChannelId: s.activeChannelId,
        activeMovieId: s.activeMovieId,
        activeEpisodeId: s.activeEpisodeId,
      }),
    },
  ),
);
