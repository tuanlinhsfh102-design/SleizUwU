import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Plus, Pencil, Trash2, Lock, Play, FileText } from 'lucide-react';
import {
  useEpisodes, useMovies, useChannels, useCreateEpisode, useUpdateEpisode, useDeleteEpisode,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, Button, Input, Field, Dialog, ConfirmDialog, Badge, EmptyState, Skeleton, Select, useToast,
} from '@sleiz/ui';
import { EPISODE_STATUSES, formatDuration, type Episode, type EpisodeStatus } from '@sleiz/shared';
import { useAppStore } from '../store/app';

export function EpisodesPage() {
  const navigate = useNavigate();
  const { activeChannelId, activeMovieId, setActiveMovie, setActiveEpisode } = useAppStore();
  const { data: channels = [] } = useChannels();
  const { data: movies = [] } = useMovies(activeChannelId || undefined);
  const { data: episodes = [], isLoading } = useEpisodes(activeMovieId || undefined);
  const [editing, setEditing] = useState<Episode | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Episode | null>(null);

  const activeMovie = movies.find((m) => m.id === activeMovieId);

  return (
    <PageContainer>
      <PageHeader
        title="Episodes"
        description={activeMovie ? `${activeMovie.titleVi} (${activeMovie.titleZh})` : 'Chọn movie để xem episodes'}
        icon={<Clapperboard size={18} />}
        actions={
          <>
            <Select
              value={activeMovieId || ''}
              onChange={(e) => setActiveMovie(e.target.value || null)}
              className="h-8 w-64 text-xs"
            >
              <option value="">— Chọn Movie —</option>
              {movies.map((m) => (
                <option key={m.id} value={m.id}>{m.titleVi}</option>
              ))}
            </Select>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreating(true)}
              disabled={!activeMovieId}
            >
              <Plus size={14} />
              Tạo Episode
            </Button>
          </>
        }
      />
      <PageContent>
        {!activeMovieId ? (
          <Card>
            <EmptyState
              icon={<Lock size={48} />}
              title="Episodes bị khóa"
              description="Vui lòng chọn Movie ở thanh công cụ bên trên."
            />
          </Card>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : episodes.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Clapperboard size={48} />}
              title="Chưa có episode nào"
              description="Tạo episode đầu tiên cho movie này"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} />
                  Tạo Episode
                </Button>
              }
            />
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <div className="grid grid-cols-[80px_1fr_120px_120px_140px_120px] gap-3 px-4 py-2 border-b border-[#2b2d31] text-2xs font-semibold text-zinc-500 uppercase tracking-wider">
              <span>Tập</span>
              <span>Tiêu đề</span>
              <span>Duration</span>
              <span>Status</span>
              <span>Cập nhật</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-[#2b2d31]">
              {episodes.map((ep) => {
                const status = EPISODE_STATUSES.find((s) => s.value === ep.status);
                return (
                  <div
                    key={ep.id}
                    className="grid grid-cols-[80px_1fr_120px_120px_140px_120px] gap-3 px-4 py-2.5 items-center hover:bg-[#2b2d31]/40 transition-colors text-sm group"
                  >
                    <span className="text-violet-300 font-mono font-semibold">#{ep.episodeNumber}</span>
                    <div className="min-w-0">
                      <div className="text-zinc-100 truncate">{ep.title}</div>
                      {ep.videoPath && <div className="text-2xs text-zinc-500 truncate">{ep.videoPath}</div>}
                    </div>
                    <span className="text-xs text-zinc-400">{ep.duration ? formatDuration(ep.duration * 1000) : '—'}</span>
                    <Badge
                      variant={
                        ep.status === 'completed' || ep.status === 'exported' ? 'success'
                        : ep.status === 'translating' ? 'warning'
                        : ep.status === 'error' ? 'error'
                        : 'default'
                      }
                      size="sm"
                    >
                      {status?.label || ep.status}
                    </Badge>
                    <span className="text-2xs text-zinc-500">{new Date(ep.updatedAt).toLocaleDateString('vi-VN')}</span>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Mở Subtitle Editor"
                        onClick={() => {
                          setActiveEpisode(ep.id);
                          navigate('/subtitle');
                        }}
                      >
                        <FileText size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Xem Video"
                        onClick={() => {
                          setActiveEpisode(ep.id);
                          navigate('/video');
                        }}
                      >
                        <Play size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" title="Sửa" onClick={() => setEditing(ep)}>
                        <Pencil size={12} />
                      </Button>
                      <Button variant="ghost" size="icon" title="Xóa" onClick={() => setConfirmDelete(ep)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </PageContent>

      {creating && activeMovieId && (
        <EpisodeDialog mode="create" movieId={activeMovieId} episodeNumber={episodes.length + 1} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <EpisodeDialog mode="edit" movieId={editing.movieId} episode={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Xóa episode?"
        description={`Xóa "${confirmDelete?.title}" sẽ xóa subtitle và batches liên quan.`}
        onConfirm={async () => {
          // handled inside dialog
        }}
      />
    </PageContainer>
  );
}

function EpisodeDialog({
  mode,
  movieId,
  episodeNumber,
  episode,
  onClose,
}: {
  mode: 'create' | 'edit';
  movieId: string;
  episodeNumber?: number;
  episode?: Episode;
  onClose: () => void;
}) {
  const createMut = useCreateEpisode();
  const updateMut = useUpdateEpisode();
  const deleteMut = useDeleteEpisode();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState<Partial<Episode>>(
    episode || {
      movieId,
      title: `Tập ${episodeNumber || 1}`,
      episodeNumber: episodeNumber || 1,
      thumbnail: '',
      videoPath: '',
      duration: null,
      status: 'pending',
    },
  );

  const update = (k: keyof Episode, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title?.trim() || form.episodeNumber == null) {
      toast({ title: 'Thiếu thông tin', variant: 'error' });
      return;
    }
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(form);
        toast({ title: 'Đã tạo episode', variant: 'success' });
      } else if (episode) {
        await updateMut.mutateAsync({ id: episode.id, ...form });
        toast({ title: 'Đã cập nhật episode', variant: 'success' });
      }
      onClose();
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!episode) return;
    try {
      await deleteMut.mutateAsync(episode.id);
      toast({ title: 'Đã xóa episode', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Lỗi xóa', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={onClose}
        title={mode === 'create' ? 'Tạo Episode' : 'Sửa Episode'}
        footer={
          <>
            {mode === 'edit' && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto">
                <Trash2 size={14} /> Xóa
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>Hủy</Button>
            <Button variant="primary" loading={createMut.isPending || updateMut.isPending} onClick={handleSave}>
              {mode === 'create' ? 'Tạo' : 'Lưu'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số tập" required>
              <Input type="number" value={form.episodeNumber ?? ''} onChange={(e) => update('episodeNumber', Number(e.target.value))} />
            </Field>
            <Field label="Duration (giây)">
              <Input
                type="number"
                value={form.duration ?? ''}
                onChange={(e) => update('duration', e.target.value ? Number(e.target.value) : null)}
                placeholder="1440"
              />
            </Field>
          </div>
          <Field label="Tiêu đề tập" required>
            <Input value={form.title || ''} onChange={(e) => update('title', e.target.value)} placeholder="Tập 1 - Khởi đầu" />
          </Field>
          <Field label="Thumbnail URL">
            <Input value={form.thumbnail || ''} onChange={(e) => update('thumbnail', e.target.value)} />
          </Field>
          <Field label="Video path / URL">
            <Input value={form.videoPath || ''} onChange={(e) => update('videoPath', e.target.value)} placeholder="/data/videos/ep01.mp4" />
          </Field>
          <Field label="Status">
            <Select value={form.status || 'pending'} onChange={(e) => update('status', e.target.value as EpisodeStatus)}>
              {EPISODE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xóa episode?"
        onConfirm={handleDelete}
      />
    </>
  );
}
