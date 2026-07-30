import { BarChart3, TrendingUp, Coins, Clock, Zap, Bot, Boxes, Database } from 'lucide-react';
import { useStatistics, useBatches } from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import { Card, CardHeader, CardTitle, CardContent, Badge, EmptyState, Skeleton } from '@sleiz/ui';
import { formatCost, formatTokens, formatDuration } from '@sleiz/shared';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';

const PIE_COLORS = ['#a78bfa', '#34d399', '#fbbf24', '#60a5fa', '#f472b6', '#22d3ee', '#f87171'];

export function StatisticsPage() {
  const { data: stats, isLoading } = useStatistics();
  const { data: batches = [] } = useBatches();

  const s = stats as {
    counts: Record<string, number>;
    tokens: number;
    cost: number;
    durationMs: number;
    recentBatches: Array<{ day: string; tokens: number; cost: number; count: number }>;
    episodeStatuses: Array<{ status: string; count: number }>;
  } | undefined;

  const episodeStatusPie = (s?.episodeStatuses || []).map((e, i) => ({
    name: e.status,
    value: e.count,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  return (
    <PageContainer>
      <PageHeader
        title="Statistics"
        description="Phân tích chi phí, throughput và tiến độ"
        icon={<BarChart3 size={18} />}
      />
      <PageContent>
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KPICard
            label="Tổng chi phí AI"
            value={formatCost(s?.cost ?? 0)}
            icon={<Coins size={16} />}
            color="rose"
            loading={isLoading}
          />
          <KPICard
            label="Tổng tokens"
            value={formatTokens(s?.tokens ?? 0)}
            icon={<Zap size={16} />}
            color="violet"
            loading={isLoading}
          />
          <KPICard
            label="Thời gian dịch"
            value={formatDuration(s?.durationMs ?? 0)}
            icon={<Clock size={16} />}
            color="teal"
            loading={isLoading}
          />
          <KPICard
            label="Tổng batches"
            value={s?.counts.batches ?? 0}
            icon={<Boxes size={16} />}
            color="cyan"
            loading={isLoading}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
          {/* Translation cost over time */}
          <Card>
            <CardHeader>
              <CardTitle>Chi phí AI (14 ngày)</CardTitle>
              <Badge variant="rose" size="sm">USD</Badge>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : (s?.recentBatches?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={s?.recentBatches}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#fb7185" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2d31" />
                    <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                    <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                    <Tooltip
                      contentStyle={{ background: '#1e1f22', border: '1px solid #3a3c41', borderRadius: 6, fontSize: 12 }}
                      formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']}
                    />
                    <Area type="monotone" dataKey="cost" stroke="#fb7185" strokeWidth={2} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<Coins size={36} />} title="Chưa có dữ liệu" />
              )}
            </CardContent>
          </Card>

          {/* Episode status pie */}
          <Card>
            <CardHeader>
              <CardTitle>Episode Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : episodeStatusPie.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={episodeStatusPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={40}
                      paddingAngle={2}
                    >
                      {episodeStatusPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
                    />
                    <Tooltip
                      contentStyle={{ background: '#1e1f22', border: '1px solid #3a3c41', borderRadius: 6, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<Boxes size={36} />} title="Chưa có episode" />
              )}
            </CardContent>
          </Card>

          {/* Tokens per day bar */}
          <Card>
            <CardHeader>
              <CardTitle>Tokens theo ngày</CardTitle>
              <Badge variant="violet" size="sm">Tokens</Badge>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : (s?.recentBatches?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={s?.recentBatches}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2d31" />
                    <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                    <YAxis stroke="#71717a" fontSize={11} tickFormatter={(v) => formatTokens(Number(v))} />
                    <Tooltip
                      contentStyle={{ background: '#1e1f22', border: '1px solid #3a3c41', borderRadius: 6, fontSize: 12 }}
                      formatter={(v: number) => [formatTokens(v), 'Tokens']}
                    />
                    <Bar dataKey="tokens" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<Zap size={36} />} title="Chưa có dữ liệu" />
              )}
            </CardContent>
          </Card>

          {/* Batches completed per day */}
          <Card>
            <CardHeader>
              <CardTitle>Batches hoàn thành / ngày</CardTitle>
              <Badge variant="success" size="sm">Completed</Badge>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[220px]" />
              ) : (s?.recentBatches?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={s?.recentBatches}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b2d31" />
                    <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickFormatter={(d) => d.slice(5)} />
                    <YAxis stroke="#71717a" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: '#1e1f22', border: '1px solid #3a3c41', borderRadius: 6, fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#34d399"
                      strokeWidth={2}
                      dot={{ fill: '#34d399', r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState icon={<TrendingUp size={36} />} title="Chưa có dữ liệu" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Batches table */}
        <Card>
          <CardHeader>
            <CardTitle>Batch gần đây</CardTitle>
            <Badge variant="default" size="sm">{batches.length}</Badge>
          </CardHeader>
          <CardContent className="!p-0">
            {batches.length === 0 ? (
              <EmptyState icon={<Boxes size={36} />} title="Chưa có batch nào" />
            ) : (
              <div className="divide-y divide-[#2b2d31] max-h-80 overflow-y-auto">
                {batches.slice(0, 20).map((b) => (
                  <div key={b.id} className="grid grid-cols-[60px_80px_120px_1fr_80px_80px] gap-3 px-4 py-2 text-xs items-center">
                    <span className="font-mono text-violet-300">#{b.batchIndex}</span>
                    <Badge
                      variant={
                        b.status === 'completed' ? 'success'
                        : b.status === 'running' ? 'warning'
                        : b.status === 'failed' ? 'error'
                        : 'default'
                      }
                      size="sm"
                    >
                      {b.status}
                    </Badge>
                    <span className="font-mono text-zinc-400">{b.processedCues}/{b.totalCues} cues</span>
                    <span className="text-zinc-500 truncate">
                      {b.provider}/{b.model}
                    </span>
                    <span className="text-amber-400">{formatTokens((b.tokenInput || 0) + (b.tokenOutput || 0))}</span>
                    <span className="text-rose-400">{formatCost(b.costUsd || 0)}</span>
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

function KPICard({
  label,
  value,
  icon,
  color,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'violet' | 'blue' | 'emerald' | 'amber' | 'cyan' | 'fuchsia' | 'rose' | 'teal';
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
    <div className={`rounded-lg border bg-gradient-to-br ${colors[color]} backdrop-blur-sm`}>
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-2xs font-medium uppercase tracking-wider opacity-70">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <div className="px-4 pb-3 mt-1">
        {loading ? <Skeleton className="h-7 w-20" /> : <div className="text-2xl font-semibold tabular-nums">{value}</div>}
      </div>
    </div>
  );
}
