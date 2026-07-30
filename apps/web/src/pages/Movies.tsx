import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Film, Plus, Pencil, Trash2, Search, Lock, Clapperboard, Upload,
  ImageIcon, X as IconX, Sparkles, FileJson, FileText,
} from 'lucide-react';
import {
  useMovies, useChannels, useCreateMovie, useUpdateMovie, useDeleteMovie, useSuggestMovieTitle,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, Button, Input, Field, Dialog, ConfirmDialog, Badge, EmptyState, Skeleton,
  Select, Textarea, useToast,
} from '@sleiz/ui';
import { MOVIE_STATUSES, type Movie, type MovieStatus } from '@sleiz/shared';
import { useAppStore } from '../store/app';
import { api } from '../api/client';

export function MoviesPage() {
  const navigate = useNavigate();
  const { activeChannelId, setActiveChannel, setActiveMovie } = useAppStore();
  const { data: channels = [] } = useChannels();
  const { data: movies = [], isLoading } = useMovies(activeChannelId || undefined);
  const deleteMut = useDeleteMovie();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Movie | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Movie | null>(null);

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  const filtered = movies.filter(
    (m) => m.titleVi.toLowerCase().includes(search.toLowerCase()) || m.titleZh.includes(search),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Bộ phim"
        description={activeChannel ? `Thuộc kênh: ${activeChannel.name}` : 'Chọn kênh để quản lý bộ phim'}
        icon={<Film size={18} />}
        actions={
          <>
            <Select
              value={activeChannelId || ''}
              onChange={(e) => setActiveChannel(e.target.value || null)}
              className="h-8 w-48 text-xs"
            >
              <option value="">— Chọn Channel —</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm bộ phim..."
                className="h-8 w-48 pl-8 text-xs"
                disabled={!activeChannelId}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreating(true)}
              disabled={!activeChannelId}
            >
              <Plus size={14} />
              Tạo Phim
            </Button>
          </>
        }
      />
      <PageContent>
        {!activeChannelId ? (
          <Card>
            <EmptyState
              icon={<Lock size={48} />}
              title="Bộ phim đang bị khóa"
              description="Vui lòng chọn Kênh ở thanh công cụ bên trên để mở danh sách phim."
            />
          </Card>
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Film size={48} />}
              title={search ? 'Không tìm thấy bộ phim' : 'Chưa có bộ phim nào'}
              description={search ? 'Thử từ khóa khác' : 'Tạo bộ phim đầu tiên cho kênh này'}
              action={
                !search && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={14} />
                    Tạo Phim
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((m) => (
              <MovieCard
                key={m.id}
                movie={m}
                onEdit={() => setEditing(m)}
                onDelete={() => setConfirmDelete(m)}
                onClick={() => {
                  setActiveMovie(m.id);
                  navigate(`/movies/${m.id}`);
                }}
              />
            ))}
          </div>
        )}
      </PageContent>

      {creating && activeChannelId && (
        <MovieDialog mode="create" channelId={activeChannelId} onClose={() => setCreating(false)} />
      )}
      {editing && <MovieDialog mode="edit" channelId={editing.channelId} movie={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title="Xóa bộ phim?"
        description={`Xóa "${confirmDelete?.titleVi}" sẽ xóa toàn bộ phụ đề và dữ liệu workspace liên quan.`}
        onConfirm={async () => {
          if (!confirmDelete) return;
          try {
            await deleteMut.mutateAsync(confirmDelete.id);
            toast({ title: 'Đã xóa bộ phim', variant: 'success' });
            setConfirmDelete(null);
          } catch (err) {
            toast({ title: 'Lỗi xóa', description: err instanceof Error ? err.message : '', variant: 'error' });
          }
        }}
      />
    </PageContainer>
  );
}

function MovieCard({
  movie,
  onEdit,
  onDelete,
  onClick,
}: {
  movie: Movie;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const status = MOVIE_STATUSES.find((s) => s.value === movie.status);
  return (
    <Card className="overflow-hidden hover:border-violet-500/40 transition-colors group cursor-pointer" onClick={onClick}>
      <div className="aspect-[16/9] relative bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20">
        {movie.poster ? (
          <img src={movie.poster} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-5xl font-bold text-white/10">
            {movie.titleVi.charAt(0)}
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge variant="default" size="sm" className="bg-black/70 border-black/40">
            {status?.label || movie.status}
          </Badge>
        </div>
        {movie.year && (
          <div className="absolute bottom-2 right-2">
            <Badge variant="default" size="sm" className="bg-black/70 border-black/40">{movie.year}</Badge>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-zinc-100 truncate">{movie.titleVi}</h3>
        <p className="text-2xs text-zinc-500 truncate">{movie.titleZh}</p>
        {movie.genres && (
          <p className="text-2xs text-zinc-600 truncate mt-1">{movie.genres}</p>
        )}
        <div className="flex items-center justify-between mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Sửa">
            <Pencil size={12} />
          </Button>
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Xóa">
            <Trash2 size={12} />
          </Button>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={(e) => { e.stopPropagation(); onClick(); }}>
            <Clapperboard size={12} />
            Mở Phim
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MovieDialog({
  mode,
  channelId,
  movie,
  onClose,
}: {
  mode: 'create' | 'edit';
  channelId: string;
  movie?: Movie;
  onClose: () => void;
}) {
  const createMut = useCreateMovie();
  const updateMut = useUpdateMovie();
  const deleteMut = useDeleteMovie();
  const suggestTitleMut = useSuggestMovieTitle();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleSourceInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [titleSourceContent, setTitleSourceContent] = useState('');
  const [titleSourceName, setTitleSourceName] = useState('');

  const [form, setForm] = useState<Partial<Movie>>(
    movie || {
      channelId,
      titleVi: '',
      poster: '',
      thumbnail: '',
      status: 'planned',
    },
  );

  const update = (k: keyof Movie, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handlePickFile = () => fileInputRef.current?.click();
  const handlePickTitleSource = () => titleSourceInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Lỗi file', description: 'Vui lòng chọn file ảnh (jpg/png/webp)', variant: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File quá lớn', description: 'Tối đa 10MB', variant: 'error' });
      return;
    }
    try {
      setUploading(true);
      const result = await api.uploadFile(file);
      update('poster', result.url);
      update('thumbnail', result.url);
      toast({ title: 'Đã tải ảnh lên', description: `${result.fileName} (${(result.size / 1024).toFixed(0)} KB)`, variant: 'success', duration: 1500 });
    } catch (err) {
      toast({
        title: 'Lỗi tải ảnh',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = () => {
    update('poster', '');
    update('thumbnail', '');
  };

  const handleTitleSourceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      setTitleSourceContent(content);
      setTitleSourceName(file.name);
      toast({
        title: 'Đã nạp dữ liệu nguồn',
        description: file.name,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Không đọc được file',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  };

  const handleSuggestTitle = async () => {
    if (!titleSourceContent.trim()) {
      toast({
        title: 'Thiếu dữ liệu',
        description: 'Dán JSON/SRT hoặc nạp file trước khi nhờ AI gợi ý tên.',
        variant: 'error',
      });
      return;
    }

    try {
      const result = await suggestTitleMut.mutateAsync({
        content: titleSourceContent,
        filename: titleSourceName || undefined,
        currentTitle: form.titleVi || '',
      });
      update('titleVi', result.data.titleVi);
      update('titleZh', result.data.titleZh || result.data.titleVi);
      update('titleEn', result.data.titleEn || '');
      update('aliases', result.data.aliases.join(', '));
      toast({
        title: 'AI đã gợi ý tên phim',
        description: `${result.data.titleVi} • ${(result.data.confidence * 100).toFixed(0)}%`,
        variant: 'success',
        duration: 4000,
      });
    } catch (err) {
      toast({
        title: 'AI chưa gợi ý được tên',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  };

  const handleSave = async () => {
    if (!form.titleVi?.trim()) {
      toast({ title: 'Thiếu thông tin', description: 'Tên bộ phim là bắt buộc', variant: 'error' });
      return;
    }
    if (uploading) {
      toast({ title: 'Vui lòng chờ', description: 'Ảnh đang được tải lên, hãy chờ giây lát...', variant: 'error' });
      return;
    }
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(form);
        toast({ title: 'Đã tạo bộ phim', description: form.titleVi, variant: 'success' });
      } else if (movie) {
        await updateMut.mutateAsync({ id: movie.id, ...form });
        toast({ title: 'Đã cập nhật bộ phim', variant: 'success' });
      }
      onClose();
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!movie) return;
    try {
      await deleteMut.mutateAsync(movie.id);
      toast({ title: 'Đã xóa bộ phim', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Lỗi xóa', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const imageUrl = form.poster || form.thumbnail;

  return (
    <>
      <Dialog
        open
        onOpenChange={onClose}
        title={mode === 'create' ? 'Tạo Bộ Phim mới' : 'Chỉnh sửa Bộ Phim'}
        className="max-w-lg"
        footer={
          <>
            {mode === 'edit' && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto">
                <Trash2 size={14} />
                Xóa
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={uploading}>Hủy</Button>
            <Button variant="primary" loading={createMut.isPending || updateMut.isPending || uploading} onClick={handleSave}>
              {mode === 'create' ? 'Tạo' : 'Lưu'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <Field label="Ảnh thumbnail YouTube" hint="Chọn ảnh thumbnail (tỉ lệ 16:9 khớp YouTube, tối đa 10MB)">
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {imageUrl ? (
                  <div className="relative w-full sm:w-72 aspect-[16/9] shrink-0 rounded-md overflow-hidden border border-zinc-700 bg-zinc-900">
                    <img
                      src={imageUrl}
                      alt="thumbnail preview"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                      title="Xóa ảnh"
                    >
                      <IconX size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="w-full sm:w-72 aspect-[16/9] shrink-0 rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 flex flex-col items-center justify-center text-zinc-500">
                    <ImageIcon size={28} strokeWidth={1.5} />
                    <span className="text-[11px] mt-1 text-center px-2">Chưa có thumbnail (16:9)</span>
                  </div>
                )}
                <div className="flex-1 flex flex-col gap-2 justify-center min-h-[10rem]">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handlePickFile}
                    loading={uploading}
                    disabled={uploading}
                    type="button"
                    className="w-fit"
                  >
                    <Upload size={14} />
                    {uploading ? 'Đang tải lên...' : imageUrl ? 'Đổi ảnh khác' : 'Chọn ảnh từ máy'}
                  </Button>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Tỉ lệ khuyến nghị: 1280×720 (16:9) như YouTube.<br />
                    Định dạng hỗ trợ: JPG, PNG, WEBP, GIF.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            </Field>
          </div>

          <Field label="Tên bộ phim" required hint="Điền tên tiếng Việt. Các tên khác (Trung, Anh) và thông tin mở rộng có thể thêm sau.">
            <Input
              autoFocus
              value={form.titleVi || ''}
              onChange={(e) => update('titleVi', e.target.value)}
              placeholder="Ví dụ: Thập Tam, Vạn Tình Cẩm Vệ, Hỏa Vũ Kỳ Ký..."
            />
          </Field>

          <Field
            label="AI gợi ý tên từ JSON / SRT"
            hint="Dán nội dung phụ đề hoặc JSON CapCut. AI sẽ dùng Gemini để đoán tên phim và tự điền vào ô trên."
          >
            <div className="space-y-2">
              <Textarea
                value={titleSourceContent}
                onChange={(e) => setTitleSourceContent(e.target.value)}
                className="min-h-[140px] font-mono text-xs"
                placeholder="Dán nội dung .json, .srt, .vtt, .ass hoặc text mẫu vào đây..."
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={handlePickTitleSource}>
                  {titleSourceName?.toLowerCase().endsWith('.json') ? <FileJson size={12} /> : <FileText size={12} />}
                  Nạp file JSON/SRT
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleSuggestTitle}
                  loading={suggestTitleMut.isPending}
                >
                  <Sparkles size={12} />
                  Gợi ý tên phim
                </Button>
                {titleSourceName && (
                  <Badge variant="info" size="sm">{titleSourceName}</Badge>
                )}
              </div>
              <input
                ref={titleSourceInputRef}
                type="file"
                accept=".json,.srt,.vtt,.ass,.ssa,.txt,application/json,text/plain"
                className="hidden"
                onChange={handleTitleSourceFileChange}
              />
            </div>
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xóa movie?"
        description={`Xóa "${movie?.titleVi}" sẽ xóa tất cả episodes và subtitles.`}
        onConfirm={handleDelete}
      />
    </>
  );
}
