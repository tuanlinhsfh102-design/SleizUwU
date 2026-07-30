import { useState } from 'react';
import { Download, FileText, FileJson, FileType, FileCode, Archive } from 'lucide-react';
import {
  useEpisodes, useSubtitle, useExportSubtitle,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Badge, EmptyState, useToast, Select,
  Tabs, TabsList, TabsTrigger, TabsContent, Textarea,
} from '@sleiz/ui';
import { useAppStore } from '../store/app';

const FORMATS = [
  { id: 'srt' as const, label: 'SubRip (.srt)', icon: <FileText size={18} />, desc: 'Phổ biến nhất, hỗ trợ mọi player' },
  { id: 'vtt' as const, label: 'WebVTT (.vtt)', icon: <FileCode size={18} />, desc: 'Cho web / HTML5 video' },
  { id: 'ass' as const, label: 'Advanced SubStation (.ass)', icon: <FileCode size={18} />, desc: 'Có style, phù hợp làm phim' },
  { id: 'txt' as const, label: 'Plain Text (.txt)', icon: <FileType size={18} />, desc: 'Chỉ text, không timestamp' },
  { id: 'json' as const, label: 'JSON (.json)', icon: <FileJson size={18} />, desc: 'Đầy đủ câu phụ đề + metadata' },
];

export function ExportPage() {
  const { toast } = useToast();
  const { activeMovieId, activeEpisodeId, setActiveEpisode, activeSubtitleId, setActiveSubtitle } = useAppStore();
  const { data: episodes = [] } = useEpisodes(activeMovieId || undefined);
  const { data: subtitle } = useSubtitle(activeSubtitleId);
  const exportMut = useExportSubtitle();
  const [format, setFormat] = useState<'srt' | 'vtt' | 'ass' | 'txt' | 'json'>('srt');
  const [preview, setPreview] = useState<{ content: string; filename: string; mimeType: string } | null>(null);

  const handleExport = async () => {
    if (!activeSubtitleId) {
      toast({ title: 'Chưa chọn phụ đề', variant: 'warning' });
      return;
    }
    try {
      const r = await exportMut.mutateAsync({ subtitleId: activeSubtitleId, format });
      setPreview(r.data);
      toast({ title: `Đã xuất ${format.toUpperCase()}`, description: `${r.data.cueCount} câu`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi xuất', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const handleDownload = () => {
    if (!preview) return;
    const blob = new Blob([preview.content], { type: preview.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = preview.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Đã tải xuống', description: preview.filename, variant: 'success' });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Xuất"
        description="Xuất subtitle đã dịch sang nhiều định dạng"
        icon={<Download size={18} />}
        actions={
          <Select
            value={activeEpisodeId || ''}
            onChange={(e) => {
              setActiveEpisode(e.target.value || null);
              setActiveSubtitle(null);
            }}
            className="h-8 w-64 text-xs"
          >
            <option value="">— Chọn tập —</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>#{ep.episodeNumber} {ep.title}</option>
            ))}
          </Select>
        }
      />
      <PageContent>
        {!activeSubtitleId ? (
          <Card>
            <EmptyState
              icon={<Download size={48} />}
              title="Chưa chọn phụ đề"
              description="Chọn tập có phụ đề đã dịch ở thanh công cụ"
            />
          </Card>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {/* Format picker */}
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle>Chọn định dạng</CardTitle>
              </CardHeader>
              <CardContent className="!p-2 space-y-1">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-md border text-left transition-colors ${
                      format === f.id
                        ? 'border-violet-500/40 bg-violet-500/10'
                        : 'border-transparent hover:bg-[#2b2d31]/60'
                    }`}
                  >
                    <span className={format === f.id ? 'text-violet-300' : 'text-zinc-400'}>{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${format === f.id ? 'text-violet-200' : 'text-zinc-200'}`}>
                        {f.label}
                      </div>
                      <div className="text-2xs text-zinc-500 mt-0.5">{f.desc}</div>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Action + preview */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Xuất & Xem trước</CardTitle>
                <div className="flex items-center gap-2">
                  {subtitle && (
                    <Badge variant="violet" size="sm">
                      {subtitle.cues.length} câu • {subtitle.cues.filter((c) => c.textTranslated).length} đã dịch
                    </Badge>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleExport}
                    loading={exportMut.isPending}
                  >
                    <Download size={12} />
                    Xuất {format.toUpperCase()}
                  </Button>
                  {preview && (
                    <Button variant="secondary" size="sm" onClick={handleDownload}>
                      <Archive size={12} />
                      Tải xuống
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {preview ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-2xs text-zinc-500">
                      <span className="font-mono">{preview.filename}</span>
                      <span>•</span>
                      <span>{preview.content.split('\n').length} dòng</span>
                      <span>•</span>
                      <span>{(preview.content.length / 1024).toFixed(1)} KB</span>
                    </div>
                    <Textarea
                      value={preview.content}
                      readOnly
                      className="font-mono text-xs min-h-[400px] resize-none"
                    />
                  </div>
                ) : (
                  <EmptyState
                    icon={<Download size={36} />}
                    title="Chưa có bản xuất"
                    description="Chọn định dạng và bấm Xuất để xem trước"
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </PageContent>
    </PageContainer>
  );
}
