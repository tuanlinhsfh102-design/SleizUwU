import { NavLink } from 'react-router-dom';
import {
  Home, Tv, Film, Settings, ChevronLeft, Search, Command, CloudDownload, Captions, Wand2,
} from 'lucide-react';
import { useAppStore } from '../store/app';
import { cn } from '@sleiz/ui';
import { APP_NAME, APP_VERSION } from '@sleiz/shared';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Tổng quan', icon: <Home size={16} />, shortcut: 'Alt+1' },
  { to: '/channels', label: 'Kênh', icon: <Tv size={16} />, shortcut: 'Alt+2' },
  { to: '/movies', label: 'Bộ phim', icon: <Film size={16} />, shortcut: 'Alt+3' },
  { to: '/download', label: 'Tải phim', icon: <CloudDownload size={16} />, shortcut: 'Alt+D' },
  // New automated pipeline: upload/URL → STT → translate → TTS → render.
  // This is the primary workflow now — the old /movie-translation page is
  // still reachable by direct URL for users who need the manual 4-step flow.
  { to: '/video', label: 'Dịch Video', icon: <Wand2 size={16} />, shortcut: 'Alt+T' },
  { to: '/settings', label: 'Cài đặt', icon: <Settings size={16} />, shortcut: 'Alt+,' },
];

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const setCmdkOpen = useAppStore((s) => s.setCommandPaletteOpen);

  return (
    <aside
      className={cn(
        'flex flex-col bg-[#131416] border-r border-[#2b2d31] transition-all duration-200',
        collapsed ? 'w-[52px]' : 'w-[220px]',
      )}
    >
      {/* Brand header */}
      <div className={cn('flex items-center h-12 px-3 border-b border-[#2b2d31]', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? (
          <div className="h-7 w-7 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-violet-900/40">
            S
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-violet-900/40">
                S
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold text-zinc-100">{APP_NAME}</span>
                <span className="text-[10px] text-zinc-500">v{APP_VERSION}</span>
              </div>
            </div>
            <button
              onClick={toggle}
              className="icon-btn h-7 w-7"
              title="Thu gọn thanh bên"
            >
              <ChevronLeft size={14} />
            </button>
          </>
        )}
      </div>

      {/* Command palette trigger */}
      <div className="p-2">
        <button
          onClick={() => setCmdkOpen(true)}
          className={cn(
            'flex items-center gap-2 h-8 rounded-md border border-[#2b2d31] bg-[#1e1f22] text-zinc-400 hover:border-violet-500/40 hover:text-zinc-200 transition-colors text-xs',
            collapsed ? 'w-8 justify-center' : 'w-full px-2.5',
          )}
          title="Bảng lệnh (Ctrl+Shift+P)"
        >
          <Search size={14} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Tìm kiếm...</span>
              <kbd className="text-[10px] px-1 py-0.5 rounded bg-[#2b2d31] border border-[#3a3c41] text-zinc-500 font-mono">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-md text-sm transition-colors',
                collapsed ? 'h-9 w-9 justify-center mx-auto' : 'h-8 px-2.5',
                isActive
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                  : 'text-zinc-400 hover:bg-[#1e1f22] hover:text-zinc-100 border border-transparent',
              )
            }
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                <kbd className="text-[10px] text-zinc-600 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.shortcut.replace('Alt+', '⌥')}
                </kbd>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-[#2b2d31] text-[10px] text-zinc-600">
          <div className="flex items-center justify-between">
            <span>© 2026 Sleiz Studio</span>
            <button
              onClick={() => setCmdkOpen(true)}
              className="flex items-center gap-1 hover:text-zinc-400 transition-colors"
              title="Mở bảng lệnh"
            >
              <Command size={10} />
              <span>⌘⇧P</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
