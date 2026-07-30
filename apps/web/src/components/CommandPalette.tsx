import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Search, Home, Tv, Film, Settings, X, CornerDownLeft, Plus, CloudDownload,
} from 'lucide-react';
import { useAppStore } from '../store/app';
import { useChannels, useMovies } from '../api/hooks';
import { cn } from '@sleiz/ui';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  action: () => void;
  keywords?: string;
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const setActiveMovie = useAppStore((s) => s.setActiveMovie);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const { data: channels = [] } = useChannels();
  const { data: movies = [] } = useMovies();

  // Global keyboard shortcut: Ctrl+Shift+P or Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Alt+number shortcuts for navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const map: Record<string, string> = {
        '1': '/dashboard',
        '2': '/channels',
        '3': '/movies',
        ',': '/settings',
        'd': '/download',
      };
      const key = e.key.toLowerCase();
      const path = map[key];
      if (path) {
        e.preventDefault();
        navigate(path);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  const items = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [
      { id: 'nav-dashboard', label: 'Tổng quan', icon: <Home size={14} />, group: 'Điều hướng', action: () => navigate('/dashboard') },
      { id: 'nav-channels', label: 'Kênh', icon: <Tv size={14} />, group: 'Điều hướng', action: () => navigate('/channels') },
      { id: 'nav-movies', label: 'Bộ phim', icon: <Film size={14} />, group: 'Điều hướng', action: () => navigate('/movies') },
      { id: 'nav-download', label: 'Tải phim', icon: <CloudDownload size={14} />, group: 'Điều hướng', action: () => navigate('/download'), keywords: 'bilibili tiktok download' },
      { id: 'nav-settings', label: 'Cài đặt', icon: <Settings size={14} />, group: 'Điều hướng', action: () => navigate('/settings') },
    ];

    const channelItems: CommandItem[] = channels.slice(0, 10).map((c) => ({
      id: `ch-${c.id}`,
      label: c.name,
      hint: 'Kênh',
      icon: <Tv size={14} />,
      group: 'Kênh',
      keywords: c.slug,
      action: () => {
        setActiveChannel(c.id);
        navigate('/movies');
      },
    }));

    const movieItems: CommandItem[] = movies.slice(0, 10).map((m) => ({
      id: `mv-${m.id}`,
      label: m.titleVi,
      hint: m.titleZh,
      icon: <Film size={14} />,
      group: 'Phim',
      keywords: `${m.titleEn || ''} ${m.aliases || ''}`,
      action: () => {
        setActiveChannel(m.channelId);
        setActiveMovie(m.id);
        navigate(`/movies/${m.id}`);
      },
    }));

    const actions: CommandItem[] = [
      {
        id: 'act-new-channel',
        label: 'Tạo kênh mới',
        icon: <Plus size={14} />,
        group: 'Thao tác',
        action: () => navigate('/channels'),
      },
      {
        id: 'act-new-movie',
        label: 'Tạo phim mới',
        icon: <Plus size={14} />,
        group: 'Thao tác',
        action: () => navigate('/movies'),
      },
    ];

    return [...nav, ...actions, ...channelItems, ...movieItems];
  }, [navigate, channels, movies, setActiveChannel, setActiveMovie]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 50);
    const q = query.toLowerCase();
    return items
      .filter((it) => {
        const hay = `${it.label} ${it.hint || ''} ${it.group} ${it.keywords || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => setOpen(false)}
      />
      <div className="relative w-full max-w-xl rounded-lg border border-[#3a3c41] bg-[#1e1f22] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 border-b border-[#2b2d31]">
          <Search size={16} className="text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = filtered[activeIdx];
                if (item) {
                  item.action();
                  setOpen(false);
                  setQuery('');
                }
              }
            }}
            placeholder="Tìm lệnh, kênh, phim..."
            className="flex-1 h-12 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[#2b2d31] border border-[#3a3c41] text-zinc-500 font-mono">
            ESC
          </kbd>
          <button onClick={() => setOpen(false)} className="icon-btn h-7 w-7">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Không tìm thấy kết quả cho "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  item.action();
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                  idx === activeIdx ? 'bg-violet-500/15 text-violet-100' : 'text-zinc-300 hover:bg-[#2b2d31]',
                )}
              >
                <span className={cn('shrink-0', idx === activeIdx ? 'text-violet-300' : 'text-zinc-500')}>
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate">{item.label}</span>
                    {item.hint && <span className="text-2xs text-zinc-500 truncate">{item.hint}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{item.group}</span>
                {idx === activeIdx && <CornerDownLeft size={12} className="text-violet-300" />}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#2b2d31] bg-[#131416] text-2xs text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[#2b2d31] border border-[#3a3c41]">↑↓</kbd>
              <span>Điều hướng</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 rounded bg-[#2b2d31] border border-[#3a3c41]">↵</kbd>
              <span>Chọn</span>
            </span>
          </div>
          <span>Bảng lệnh Sleiz Studio</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
