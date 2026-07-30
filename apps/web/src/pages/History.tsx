import { useState } from 'react';
import { History, Trash2, Search } from 'lucide-react';
import { useHistory, useClearHistory } from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import { Card, Button, Input, Badge, EmptyState, ConfirmDialog, useToast, Select } from '@sleiz/ui';
import { timeAgo } from '@sleiz/shared';

const ACTION_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default' | 'violet'> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  import: 'violet',
  export: 'info',
  translate: 'violet',
  download: 'cyan' as never,
  convert: 'info',
  review: 'warning',
  restore: 'success',
};

export function HistoryPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const { toast } = useToast();
  const clearMut = useClearHistory();

  const { data: history = [], isLoading } = useHistory({
    action: action || undefined,
    entityType: entityType || undefined,
    limit: 500,
  });

  const filtered = history.filter((h) => {
    if (search) {
      const q = search.toLowerCase();
      const hay = `${h.entityName || ''} ${h.entityType} ${h.details || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PageContainer>
      <PageHeader
        title="History"
        description="Audit log toàn bộ thao tác trong ứng dụng"
        icon={<History size={18} />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={history.length === 0}>
              <Trash2 size={14} />
              Xóa tất cả
            </Button>
          </>
        }
      />
      <PageContent>
        <Card className="!p-0">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2b2d31]">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm trong history..."
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-8 w-32 text-xs">
              <option value="">Tất cả action</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="import">Import</option>
              <option value="export">Export</option>
              <option value="translate">Translate</option>
              <option value="download">Download</option>
              <option value="review">Review</option>
            </Select>
            <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="h-8 w-36 text-xs">
              <option value="">Tất cả entity</option>
              <option value="channel">Channel</option>
              <option value="movie">Movie</option>
              <option value="episode">Episode</option>
              <option value="subtitle">Subtitle</option>
              <option value="glossary">Glossary</option>
              <option value="bilibili">Bilibili</option>
              <option value="ai-description">AI Description</option>
            </Select>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-zinc-500">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<History size={48} />}
              title={search || action || entityType ? 'Không tìm thấy' : 'Chưa có history'}
              description={search || action || entityType ? 'Thử bộ lọc khác' : 'Bắt đầu sử dụng app để thấy audit log'}
            />
          ) : (
            <div className="divide-y divide-[#2b2d31] max-h-[calc(100vh-220px)] overflow-y-auto">
              {filtered.map((h) => (
                <div key={h.id} className="grid grid-cols-[100px_120px_1fr_120px] gap-3 px-4 py-2.5 items-center hover:bg-[#2b2d31]/40 transition-colors text-sm">
                  <Badge variant={ACTION_VARIANTS[h.action] || 'default'} size="sm">
                    {h.action}
                  </Badge>
                  <span className="text-2xs text-zinc-500 uppercase">{h.entityType}</span>
                  <div className="min-w-0">
                    <span className="text-zinc-200">{h.entityName || '—'}</span>
                    {h.details && <span className="text-zinc-500 ml-2 text-xs">— {h.details}</span>}
                  </div>
                  <span className="text-2xs text-zinc-500 text-right">{timeAgo(h.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </PageContent>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Xóa toàn bộ history?"
        description="Hành động này không thể hoàn tác. Tất cả audit log sẽ bị xóa vĩnh viễn."
        onConfirm={async () => {
          await clearMut.mutateAsync();
          toast({ title: 'Đã xóa history', variant: 'success' });
        }}
      />
    </PageContainer>
  );
}
