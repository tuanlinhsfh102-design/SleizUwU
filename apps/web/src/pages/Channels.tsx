import { useState } from 'react';
import {
  Tv, Plus, Pencil, Trash2, Youtube, Mail, Globe, Heart,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useChannels, useCreateChannel, useUpdateChannel, useDeleteChannel,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, Button, Input, Textarea, Field, Dialog, ConfirmDialog, Badge, EmptyState, Skeleton,
  useToast,
} from '@sleiz/ui';
import { AI_PROVIDER_LABELS, AI_DEFAULT_MODELS, SUBTITLE_TRANSLATION_SYSTEM_PROMPT, type Channel } from '@sleiz/shared';
import { useAppStore } from '../store/app';

// Default values auto-applied to new channels so the AI description generator
// keeps working even when the user only fills in name + description.
const CHANNEL_DEFAULTS = {
  templateDescription: '{{introduction}}\n\n{{highlights}}\n\n{{callToAction}}\n\n{{donateMessage}}\n\n{{hashtags}}',
  templateHashtag: '#SleizVietsub #{{movieSlug}} #AnimeVietSub',
  templateThumbnail: '',
  aiPrompt: SUBTITLE_TRANSLATION_SYSTEM_PROMPT,
  aiProvider: 'gemini' as const,
  aiModel: AI_DEFAULT_MODELS.gemini,
};

export function ChannelsPage() {
  const { data: channels = [], isLoading } = useChannels();
  const deleteMut = useDeleteChannel();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Channel | null>(null);

  const filtered = channels.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.slug.includes(search.toLowerCase()),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Kênh"
        description="Quản lý các kênh vietsub (mỗi kênh có cấu hình AI và template riêng)"
        icon={<Tv size={18} />}
        actions={
          <>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm kênh..."
                className="h-8 w-56 pl-8 text-xs"
              />
            </div>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} />
              Tạo kênh
            </Button>
          </>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Tv size={48} />}
              title={search ? 'Không tìm thấy kênh' : 'Chưa có kênh nào'}
              description={search ? 'Thử từ khóa khác' : 'Tạo kênh đầu tiên để bắt đầu dịch phim'}
              action={
                !search && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus size={14} />
                    Tạo kênh đầu tiên
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((c) => (
              <ChannelCard key={c.id} channel={c} onEdit={() => setEditing(c)} onDelete={() => setConfirmDelete(c)} />
            ))}
          </div>
        )}
      </PageContent>

      {creating && <ChannelDialog mode="create" onClose={() => setCreating(false)} />}
      {editing && <ChannelDialog mode="edit" channel={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && !deleteMut.isPending && setConfirmDelete(null)}
        title="Xóa kênh?"
        description={`Bạn có chắc muốn xóa "${confirmDelete?.name}"? Tất cả phim, tập phim, phụ đề thuộc kênh này sẽ bị xóa theo.`}
        confirmText="Xóa"
        loading={deleteMut.isPending}
        onConfirm={async () => {
          if (confirmDelete) {
            try {
              await deleteMut.mutateAsync(confirmDelete.id);
              toast({ title: 'Đã xóa kênh', description: confirmDelete.name, variant: 'success' });
              setConfirmDelete(null);
            } catch (err) {
              toast({
                title: 'Lỗi xóa kênh',
                description: err instanceof Error ? err.message : 'Lỗi không xác định',
                variant: 'error',
              });
            }
          }
        }}
      />
    </PageContainer>
  );
}

function ChannelCard({ channel, onEdit, onDelete }: { channel: Channel; onEdit: () => void; onDelete: () => void }) {
  const setActive = useAppStore((s) => s.setActiveChannel);
  const navigate = useNavigate();
  const { toast } = useToast();
  return (
    <Card className="overflow-hidden hover:border-violet-500/40 transition-colors group">
      {channel.banner ? (
        <div className="h-20 bg-gradient-to-br from-violet-600/30 to-fuchsia-600/30 relative">
          <img src={channel.banner} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-20 bg-gradient-to-br from-violet-600/30 via-fuchsia-600/20 to-blue-600/30 relative">
          <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-white/20">
            {channel.name.charAt(0)}
          </div>
        </div>
      )}
      <div className="p-4 -mt-8 relative">
        <div className="flex items-end gap-3 mb-3">
          <div className="h-14 w-14 rounded-md border-2 border-[#1e1f22] bg-[#131416] overflow-hidden shrink-0">
            {channel.avatar ? (
              <img src={channel.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xl font-bold text-violet-300">
                {channel.name.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{channel.name}</h3>
            <p className="text-2xs text-zinc-500 truncate">@{channel.slug}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {channel.youtube && (
            <Badge variant="error" size="sm"><Youtube size={10} /> YouTube</Badge>
          )}
          {channel.tiktok && <Badge variant="info" size="sm">TikTok</Badge>}
          {channel.facebook && <Badge variant="info" size="sm">Facebook</Badge>}
          {channel.discord && <Badge variant="violet" size="sm">Discord</Badge>}
          {channel.website && <Badge variant="cyan" size="sm"><Globe size={10} /> Web</Badge>}
          {channel.email && <Badge variant="default" size="sm"><Mail size={10} /> Email</Badge>}
        </div>

        <div className="flex items-center justify-between text-2xs text-zinc-500 mb-3">
          <span className="flex items-center gap-1">
            <Heart size={10} />
            {channel.bankName || 'Chưa có thông tin ủng hộ'}
          </span>
          {channel.aiProvider && (
            <Badge variant="violet" size="sm">{AI_PROVIDER_LABELS[channel.aiProvider] || channel.aiProvider}</Badge>
          )}
        </div>

        <div className="flex items-center gap-1 group-hover:opacity-100 transition-opacity">
          <Button
            variant="primary"
            size="sm"
            className="flex-1"
            onClick={() => {
              setActive(channel.id);
              toast({ title: 'Đã chọn kênh', description: channel.name, variant: 'success', duration: 1500 });
              navigate('/movies');
            }}
          >
            Chọn
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} title="Chỉnh sửa">
            <Pencil size={14} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Xóa">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ChannelDialog({
  mode,
  channel,
  onClose,
}: {
  mode: 'create' | 'edit';
  channel?: Channel;
  onClose: () => void;
}) {
  const createMut = useCreateChannel();
  const updateMut = useUpdateChannel();
  const deleteMut = useDeleteChannel();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState<Partial<Channel>>(
    channel
      ? { name: channel.name, description: channel.description ?? '' }
      : { name: '', description: '' },
  );

  const update = (k: keyof Channel, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) {
      toast({ title: 'Thiếu thông tin', description: 'Tên kênh là bắt buộc', variant: 'error' });
      return;
    }
    try {
      if (mode === 'create') {
        // New channels get the AI/template defaults so the metadata generator
        // works out of the box. The form only collects name + description.
        const payload = {
          ...CHANNEL_DEFAULTS,
          name: form.name.trim(),
          description: form.description?.trim() || null,
        };
        await createMut.mutateAsync(payload);
        toast({ title: 'Đã tạo kênh', description: form.name, variant: 'success' });
      } else if (channel) {
        const payload = {
          name: form.name.trim(),
          description: form.description?.trim() || null,
        };
        await updateMut.mutateAsync({ id: channel.id, ...payload });
        toast({ title: 'Đã cập nhật kênh', variant: 'success' });
      }
      onClose();
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: err instanceof Error ? err.message : 'Lỗi không xác định',
        variant: 'error',
      });
    }
  };

  const handleDelete = async () => {
    if (!channel) return;
    try {
      await deleteMut.mutateAsync(channel.id);
      toast({ title: 'Đã xóa kênh', variant: 'success' });
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
        title={mode === 'create' ? 'Tạo kênh mới' : 'Chỉnh sửa kênh'}
        description="Chỉ cần tên kênh — phần còn lại dùng cấu hình mặc định"
        className="max-w-md"
        footer={
          <>
            {mode === 'edit' && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto" >
                <Trash2 size={14} />
                Xóa
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
          <Field label="Tên kênh" required>
            <Input
              value={form.name || ''}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Sleiz Vietsub"
              autoFocus
            />
          </Field>
          <Field label="Mô tả" hint="Ghi chú ngắn về kênh (tùy chọn)">
            <Textarea
              value={form.description || ''}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Kênh vietsub anime Trung Quốc..."
              className="min-h-[80px]"
            />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xóa kênh?"
        description={`Xóa "${channel?.name}" sẽ xóa tất cả phim, tập phim, phụ đề liên quan.`}
        confirmText="Xóa vĩnh viễn"
        onConfirm={handleDelete}
      />
    </>
  );
}
