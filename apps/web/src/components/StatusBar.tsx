import { useEffect, useState } from 'react';
import { Activity, Database, Github, Zap, CheckCircle2, AlertCircle, Radio, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/app';
import { useSettings, useStatistics } from '../api/hooks';
import { formatTokens, formatCost } from '@sleiz/shared';
import { useRealtimeStatus, useRealtimeStore } from '../hooks/useRealtimeSync';

export function StatusBar() {
  const msg = useAppStore((s) => s.statusBarMessage);
  const { data: settings } = useSettings();
  const { data: stats } = useStatistics();
  const [time, setTime] = useState(new Date());
  const realtimeStatus = useRealtimeStatus();
  const eventsReceived = useRealtimeStore((s) => s.eventsReceived);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="flex items-center h-6 bg-gradient-to-r from-violet-700 via-violet-800 to-violet-700 text-violet-100 text-2xs select-none">
      <div className="flex items-center gap-0.5">
        <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50">
          <CheckCircle2 size={10} />
          <span>Sleiz Studio</span>
        </span>
        <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50">
          <GitBranchIcon />
          <span>main</span>
        </span>
        <RealtimeChip status={realtimeStatus} events={eventsReceived} />
        {msg && (
          <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50">
            <Zap size={10} />
            <span>{msg}</span>
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        {Boolean(stats) && (
          <>
            <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50" title="Tokens đã dùng">
              <Activity size={10} />
              <span>{formatTokens((stats as { tokens: number }).tokens || 0)} token</span>
            </span>
            <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50" title="Chi phí AI">
              <span>{formatCost((stats as { cost: number }).cost || 0)}</span>
            </span>
          </>
        )}
        <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50" title="Cơ sở dữ liệu">
          <Database size={10} />
          <span>SQLite</span>
        </span>
        <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50" title="Nhà cung cấp">
          <span>{settings?.defaultProvider || 'gemini'}</span>
        </span>
        <span className="status-bar-item !text-violet-100 hover:!bg-violet-600/50" title="Đồng hồ hệ thống">
          <span className="font-mono">{time.toLocaleTimeString('vi-VN')}</span>
        </span>
      </div>
    </footer>
  );
}

function RealtimeChip({ status, events }: { status: string; events: number }) {
  const label = {
    off: 'Realtime off',
    connecting: 'Realtime…',
    connected: 'Realtime live',
    error: 'Realtime lỗi',
  }[status] || 'Realtime';

  const title = {
    off: 'Chưa cấu hình Supabase — đang dùng polling',
    connecting: 'Đang kết nối Supabase Realtime…',
    connected: `Supabase Realtime đã kết nối — đã nhận ${events} sự kiện`,
    error: 'Kết nối Supabase Realtime bị lỗi — đang dùng polling',
  }[status] || 'Realtime';

  return (
    <span
      className="status-bar-item !text-violet-100 hover:!bg-violet-600/50"
      title={title}
    >
      {status === 'connecting' && <Loader2 size={10} className="animate-spin" />}
      {status === 'connected' && <Radio size={10} className="text-emerald-200" />}
      {status === 'off' && <Radio size={10} className="opacity-60" />}
      {status === 'error' && <AlertCircle size={10} className="text-rose-200" />}
      <span>{label}</span>
    </span>
  );
}

function GitBranchIcon() {
  return <Github size={10} />;
}
