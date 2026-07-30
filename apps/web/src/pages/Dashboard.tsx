import {
  Tv, Film, Clapperboard, FileText, Boxes, Coins, Clock, TrendingUp,
  Bot, Sparkles, ArrowRight, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStatistics, useHistory } from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import { Card, CardHeader, CardTitle, CardContent, Button, Skeleton, Badge, EmptyState } from '@sleiz/ui';
import { formatCost, formatTokens, formatDuration, timeAgo } from '@sleiz/shared';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar,
} from 'recharts';

interface Stats {
  counts: {
    channels: number;
    movies: number;
    episodes: number;
    subtitles: number;
    batches: number;
    glossaryEntries: number;
    translationMemory: number;
  };
  tokens: number;
  cost: number;
  durationMs: number;
  episodesToday: number;
  recentBatches: Array<{ day: string; tokens: number; cost: number; count: number }>;
  episodeStatuses: Array<{ status: string; count: number }>;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useStatistics();
  const { data: history = [] } = useHistory({ limit: 8 });

  const s = stats as Stats | undefined;

  return (
    <PageContainer>
      <PageHeader
        title="Tổng quan"
        description="Tổng quan tiến độ dịch và chi phí AI"
        icon={<Sparkles size={18} />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate('/statistics')}>
              Xem thống kê
              <ArrowRight size={14} />
            </Button>
            <Button variant="primary" size="sm" onClick={() => navigate('/subtitle')}>
              <Zap size={14} />
              Dịch ngay
            </Button>
          </>
        }
      />
      <PageContent>
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard
            label="Kênh"
            value={s?.counts.channels ?? 0}
            icon={<Tv size={16} />}
            color="violet"
            onClick={() => navigate('/channels')}
            loading={isLoading}
          />
          <StatCard
            label="Phim"
            value={s?.counts.movies ?? 0}
            icon={<Film size={16} />}
            color="blue"
            onClick={() => navigate('/movies')}
            loading={isLoading}
          />
          <StatCard
            label="Tập phim"
            value={s?.counts.episodes ?? 0}
            icon={<Clapperboard size={16} />}
            color="emerald"
            sub={`${s?.episodesToday ?? 0} hôm nay`}
            onClick={() => navigate('/episodes')}
            loading={isLoading}
          />
          <StatCard
            label="Phụ đề"
            value={s?.counts.subtitles ?? 0}
            icon={<FileText size={16} />}
            color="amber"
            onClick={() => navigate('/subtitle')}
            loading={isLoading}
          />
          <StatCard
            label="Lô dịch"
            value={s?.counts.batches ?? 0}
            icon={<Boxes size={16} />}
            color="cyan"
            onClick={() => navigate('/statistics')}
            loading={isLoading}
          />
          <StatCard
            label="Token đã dùng"
            value={formatTokens(s?.tokens ?? 0)}
            icon={<Bot size={16} />}
            color="fuchsia"
            onClick={() => navigate('/statistics')}
            loading={isLoading}
          />
          <StatCard
            label="Chi phí AI"
            value={formatCost(s?.cost ?? 0)}
            icon={<Coins size={16} />}
            color="rose"
            sub="Tổng cộng"
            onClick={() => navigate('/statistics')}
            loading={isLoading}
          />
          <StatCard
            label="Thời gian dịch"
            value={formatDuration(s?.durationMs ?? 0)}
            icon={<Clock size={16} />}
            color="teal"
            sub="Tổng cộng"
            onClick={() => navigate('/statistics')}
            loading={isLoading}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Tốc độ dịch (14 ngày qua)</CardTitle>
              <Badge variant="violet" size="sm">
                <TrendingUp size={10} />
                Hoạt động
              </Badge>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[200px]" />
              ) : (s?.recentBatches?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={s?.recentBatches}>
                    <defs>
                      <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2d31" />
                    <XAxis
                      dataKey="day"
                      stroke="#71717a"
                      fontSize={11}
                      tickFormatter={(d) => d.slice(5)}
                    />
                    <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => formatTokens(Number(v))} />
                    <Tooltip
                      contentStyle={{
                        background: '#1e1f22',
                        border: '1px solid #3a3c41',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [formatTokens(value), 'Token']}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      fill="url(#colorTokens)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={<Boxes size={36} />}
                  title="Chưa có dữ liệu"
                  description="Hoàn thành lô dịch đầu tiên để thấy biểu đồ"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trạng thái tập</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[200px]" />
              ) : (s?.episodeStatuses?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={s?.episodeStatuses} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2d31" />
                    <XAxis type="number" stroke="#71717a" fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="status"
                      stroke="#71717a"
                      fontSize={11}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#1e1f22',
                        border: '1px solid #3a3c41',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<Clapperboard size={36} />} title="Chưa có tập nào" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle>Hoạt động gần đây</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/history')}>
              Xem tất cả
              <ArrowRight size={12} />
            </Button>
          </CardHeader>
          <CardContent className="!p-0">
            {history.length === 0 ? (
              <EmptyState icon={<Clock size={36} />} title="Chưa có hoạt động" description="Bắt đầu bằng việc tạo kênh hoặc nhập phụ đề" />
            ) : (
              <div className="divide-y divide-[#2b2d31]">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#2b2d31]/40 transition-colors">
                    <Badge
                      variant={h.action === 'create' ? 'success' : h.action === 'delete' ? 'error' : h.action === 'error' ? 'error' : 'default'}
                      size="sm"
                    >
                      {h.action}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-200">{h.entityName || h.entityType}</span>
                      {h.details && <span className="text-zinc-500 ml-2 text-xs">— {h.details}</span>}
                    </div>
                    <span className="text-2xs text-zinc-500 shrink-0">{timeAgo(h.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageContent>
    </PageContainer>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  sub,
  onClick,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'violet' | 'blue' | 'emerald' | 'amber' | 'cyan' | 'fuchsia' | 'rose' | 'teal';
  sub?: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  const colors: Record<string, string> = {
    violet: 'from-violet-500/20 to-violet-500/5 text-violet-300 border-violet-500/20',
    blue: 'from-blue-500/20 to-blue-500/5 text-blue-300 border-blue-500/20',
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-300 border-emerald-500/20',
    amber: 'from-amber-500/20 to-amber-500/5 text-amber-300 border-amber-500/20',
    cyan: 'from-cyan-500/20 to-cyan-500/5 text-cyan-300 border-cyan-500/20',
    fuchsia: 'from-fuchsia-500/20 to-fuchsia-500/5 text-fuchsia-300 border-fuchsia-500/20',
    rose: 'from-rose-500/20 to-rose-500/5 text-rose-300 border-rose-500/20',
    teal: 'from-teal-500/20 to-teal-500/5 text-teal-300 border-teal-500/20',
  };
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border bg-gradient-to-br ${colors[color]} backdrop-blur-sm hover:scale-[1.02] transition-transform`}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-2xs font-medium uppercase tracking-wider opacity-70">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <div className="px-4 pb-3 mt-1">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        )}
        {sub && <div className="text-2xs opacity-60 mt-0.5">{sub}</div>}
      </div>
    </button>
  );
}
