import { useState } from 'react';
import { Bot, Zap, Sparkles, Image as ImageIcon, CheckCircle2, AlertTriangle, Copy, Loader2, Download, Eye, FileText, Volume2 } from 'lucide-react';
import {
  useEpisodes, useSubtitle, useAITranslate, useAISpeech, useAIDescription, useAIThumbnail, useAIConsistency,
  useGlossary, useCreateGlossaryEntry, useDeleteGlossaryEntry,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input, Textarea, Field, Badge,
  EmptyState, Tabs, TabsList, TabsTrigger, TabsContent, useToast, Select,
} from '@sleiz/ui';
import { useAppStore } from '../store/app';
import { GLOSSARY_TYPES } from '@sleiz/shared';

export function AIPage() {
  const { activeMovieId, activeEpisodeId, setActiveEpisode, activeSubtitleId } = useAppStore();
  const { data: episodes = [] } = useEpisodes(activeMovieId || undefined);
  const [tab, setTab] = useState('translate');

  return (
    <PageContainer>
      <PageHeader
        title="Trung tâm AI"
        description="Dịch, sinh mô tả, gợi ý thumbnail, kiểm tra nhất quán"
        icon={<Bot size={18} />}
        actions={
          <Select
            value={activeEpisodeId || ''}
            onChange={(e) => setActiveEpisode(e.target.value || null)}
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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="translate">Thử dịch</TabsTrigger>
            <TabsTrigger value="speech">Tạo giọng nói</TabsTrigger>
            <TabsTrigger value="description">Mô tả</TabsTrigger>
            <TabsTrigger value="thumbnail">Ảnh thumbnail</TabsTrigger>
            <TabsTrigger value="consistency">Nhất quán</TabsTrigger>
            <TabsTrigger value="glossary">Từ điển</TabsTrigger>
          </TabsList>

          <TabsContent value="translate" className="mt-4">
            <TranslateTestPanel />
          </TabsContent>
          <TabsContent value="speech" className="mt-4">
            <SpeechPanel />
          </TabsContent>
          <TabsContent value="description" className="mt-4">
            <DescriptionPanel />
          </TabsContent>
          <TabsContent value="thumbnail" className="mt-4">
            <ThumbnailPanel />
          </TabsContent>
          <TabsContent value="consistency" className="mt-4">
            <ConsistencyPanel />
          </TabsContent>
          <TabsContent value="glossary" className="mt-4">
            <GlossaryPanel />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageContainer>
  );
}

const GROQ_TTS_MAX_LENGTH = 200;
const GROQ_TTS_MODELS = [
  { value: 'canopylabs/orpheus-v1-english', label: 'Orpheus English' },
  { value: 'canopylabs/orpheus-arabic-saudi', label: 'Orpheus Arabic (Saudi)' },
];
const GROQ_TTS_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'];

function SpeechPanel() {
  const { toast } = useToast();
  const mut = useAISpeech();
  const [text, setText] = useState('Xin chào, đây là bản thử giọng nói từ văn bản.');
  const [model, setModel] = useState(GROQ_TTS_MODELS[0].value);
  const [voice, setVoice] = useState('autumn');
  const [result, setResult] = useState<{ audioUrl: string; fileName: string; bytes: number } | null>(null);
  const overLimit = text.length > GROQ_TTS_MAX_LENGTH;

  const handleGenerate = async () => {
    if (!text.trim() || overLimit) return;
    try {
      const response = await mut.mutateAsync({ text, model, voice });
      setResult(response.data);
      toast({ title: 'Đã tạo file WAV', description: 'Có thể nghe thử hoặc tải file xuống.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Không thể tạo giọng nói', description: error instanceof Error ? error.message : '', variant: 'error' });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tạo giọng nói từ văn bản</CardTitle>
          <Badge variant="info" size="sm">Groq TTS</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Văn bản"
            hint="Groq giới hạn 200 ký tự cho mỗi lần tạo. Dấu chỉ dẫn như [cheerful] có thể đặt ở đầu câu."
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={GROQ_TTS_MAX_LENGTH + 1}
              className="min-h-[150px]"
              placeholder="Nhập văn bản cần đọc..."
            />
          </Field>
          <div className={`text-right text-2xs ${overLimit ? 'text-red-400' : 'text-zinc-500'}`}>
            {text.length}/{GROQ_TTS_MAX_LENGTH} ký tự
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <Select value={model} onChange={(event) => setModel(event.target.value)}>
                {GROQ_TTS_MODELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
            <Field label="Giọng đọc">
              <Select value={voice} onChange={(event) => setVoice(event.target.value)}>
                {GROQ_TTS_VOICES.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
            Groq hiện chỉ công bố model tiếng Anh và Arabic Saudi. Có thể nhập tiếng Việt, nhưng phát âm tiếng Việt không được đảm bảo.
          </div>
          <Button variant="primary" onClick={handleGenerate} loading={mut.isPending} disabled={!text.trim() || overLimit}>
            <Volume2 size={14} />
            Tạo giọng nói WAV
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Nghe và tải file</CardTitle></CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4">
              <audio controls src={result.audioUrl} className="w-full">Trình duyệt không hỗ trợ phát audio.</audio>
              <div className="text-xs text-zinc-500">{result.fileName} · {(result.bytes / 1024).toFixed(1)} KB · WAV</div>
              <a href={result.audioUrl} download={result.fileName}>
                <Button variant="secondary"><Download size={14} />Tải file WAV</Button>
              </a>
            </div>
          ) : (
            <EmptyState icon={<Volume2 size={36} />} title="Chưa có audio" description="Nhập văn bản và bấm Tạo giọng nói." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TranslateTestPanel() {
  const { toast } = useToast();
  const mut = useAITranslate();
  const { activeChannelId, activeMovieId } = useAppStore();
  const [text, setText] = useState('你好世界,我是Thập Tam。');
  const [result, setResult] = useState<{ source: string; target: string; fromMemory: boolean; usage: unknown } | null>(null);

  const handleTranslate = async () => {
    if (!text.trim()) return;
    try {
      const r = await mut.mutateAsync({
        text,
        channelId: activeChannelId || undefined,
        movieId: activeMovieId || undefined,
      });
      setResult(r.data as typeof result);
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Nhập câu cần dịch</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="你好世界"
            className="font-mono min-h-[200px]"
          />
          <Button variant="primary" className="mt-3" onClick={handleTranslate} loading={mut.isPending}>
            <Zap size={14} />
            Dịch
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kết quả</CardTitle>
          {result?.fromMemory && <Badge variant="success" size="sm">Từ bộ nhớ dịch</Badge>}
        </CardHeader>
        <CardContent>
          {result ? (
            <>
              <Textarea value={result.target} readOnly className="font-mono min-h-[200px] text-violet-200" />
              <div className="mt-3 text-2xs text-zinc-500">
                Nhà cung cấp: {(result.usage as { provider?: string })?.provider || '—'} •
                Token: {(result.usage as { totalTokens?: number })?.totalTokens || 0} •
                Chi phí: ${((result.usage as { costUsd?: number })?.costUsd ?? 0).toFixed(4)}
              </div>
            </>
          ) : (
            <EmptyState icon={<Bot size={36} />} title="Chưa có kết quả" description="Nhập câu và bấm Dịch" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DescriptionPanel() {
  const { toast } = useToast();
  const mut = useAIDescription();
  const { activeEpisodeId } = useAppStore();
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');

  const handleGen = async () => {
    if (!activeEpisodeId) {
      toast({ title: 'Chưa chọn tập', variant: 'warning' });
      return;
    }
    try {
      const r = await mut.mutateAsync({ episodeId: activeEpisodeId });
      setResult(r.data as Record<string, string>);
      toast({ title: 'Đã sinh mô tả', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const description = result?.youtubeDescription || '';

  const handleCopy = async () => {
    if (!description) return;
    try {
      await navigator.clipboard.writeText(description);
      toast({ title: 'Đã copy mô tả', variant: 'success' });
    } catch {
      toast({ title: 'Không copy được', variant: 'error' });
    }
  };

  const handleDownload = () => {
    if (!description) return;
    const blob = new Blob([description], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mo-ta-${activeEpisodeId || 'episode'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Đã tải mô tả', variant: 'success' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sinh mô tả AI</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleGen} loading={mut.isPending} disabled={!activeEpisodeId}>
            <Sparkles size={12} />
            Sinh mô tả
          </Button>
          {result && (
            <>
              <Button variant="secondary" size="sm" onClick={handleCopy}>
                <Copy size={12} />
                Copy
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download size={12} />
                Tải mô tả
              </Button>
              <div className="flex items-center gap-1 ml-1 p-0.5 rounded-md border border-[#2b2d31] bg-[#131416]">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`flex items-center gap-1 px-2 py-1 text-2xs rounded transition-colors ${
                    viewMode === 'preview' ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Xem trước (rendered)"
                >
                  <Eye size={11} />
                  Preview
                </button>
                <button
                  onClick={() => setViewMode('raw')}
                  className={`flex items-center gap-1 px-2 py-1 text-2xs rounded transition-colors ${
                    viewMode === 'raw' ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Bản raw text"
                >
                  <FileText size={11} />
                  Raw
                </button>
              </div>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!result ? (
          <EmptyState
            icon={<Sparkles size={36} />}
            title="Sinh mô tả YouTube hoàn chỉnh"
            description="Bấm 'Sinh mô tả' để AI tạo 1 khối mô tả sẵn sàng dán vào YouTube (đã bao gồm tiêu đề + hashtag bên trong)"
          />
        ) : (
          <div className="space-y-3">
            {viewMode === 'preview' ? (
              <div className="rounded-md border border-[#2b2d31] bg-[#131416] p-4 max-h-[600px] overflow-y-auto">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-200 leading-relaxed">
                  {description || '(mô tả trống)'}
                </pre>
              </div>
            ) : (
              <Textarea
                value={description}
                readOnly
                className="font-mono text-xs min-h-[500px] resize-y"
              />
            )}
            <div className="flex items-center justify-between text-2xs text-zinc-500">
              <span>{description.length} ký tự • {description.split('\n').length} dòng</span>
              <span>Nhà cung cấp: {result.provider || 'AI'} • Token: {(result.usage as { totalTokens?: number })?.totalTokens || 0}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ThumbnailPanel() {
  const { toast } = useToast();
  const mut = useAIThumbnail();
  const { activeEpisodeId } = useAppStore();
  const [result, setResult] = useState<Record<string, string> | null>(null);

  const handleGen = async () => {
    if (!activeEpisodeId) {
      toast({ title: 'Chưa chọn tập', variant: 'warning' });
      return;
    }
    try {
      const r = await mut.mutateAsync({ episodeId: activeEpisodeId });
      setResult(r.data as Record<string, string>);
      toast({ title: 'Đã gợi ý thumbnail', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt ảnh thumbnail AI</CardTitle>
        <Button variant="primary" size="sm" onClick={handleGen} loading={mut.isPending} disabled={!activeEpisodeId}>
          <ImageIcon size={12} />
          Gợi ý thumbnail
        </Button>
      </CardHeader>
      <CardContent>
        {!result ? (
          <EmptyState icon={<ImageIcon size={36} />} title="Gợi ý text, màu sắc, prompt AI" description="Dùng cho Midjourney/DALL-E/Stable Diffusion" />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Chữ trên thumbnail">
                <Input value={result.thumbnailText || ''} readOnly />
              </Field>
              <Field label="Tiêu đề phụ">
                <Input value={result.title || ''} readOnly />
              </Field>
              <Field label="Màu chính">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded border border-[#3a3c41]" style={{ background: result.primaryColor || '#FF3B30' }} />
                  <Input value={result.primaryColor || ''} readOnly />
                </div>
              </Field>
              <Field label="Màu phụ">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded border border-[#3a3c41]" style={{ background: result.secondaryColor || '#000000' }} />
                  <Input value={result.secondaryColor || ''} readOnly />
                </div>
              </Field>
              <Field label="Cảm xúc">
                <Input value={result.emotion || ''} readOnly />
              </Field>
              <Field label="Nhân vật chính">
                <Input value={result.mainCharacter || ''} readOnly />
              </Field>
            </div>
            <Field label="Nền">
              <Textarea value={result.background || ''} readOnly />
            </Field>
            <Field label="Prompt ảnh (tiếng Anh)">
              <Textarea value={result.imagePrompt || ''} readOnly className="font-mono text-xs min-h-[120px]" />
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => {
                  navigator.clipboard.writeText(result.imagePrompt || '');
                  toast({ title: 'Đã copy prompt', variant: 'success' });
                }}
              >
                <Copy size={12} />
                Copy prompt
              </Button>
            </Field>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConsistencyPanel() {
  const { toast } = useToast();
  const mut = useAIConsistency();
  const { activeSubtitleId, setActiveSubtitle, activeEpisodeId } = useAppStore();
  const { data: subtitle } = useSubtitle(activeSubtitleId);
  const [result, setResult] = useState<{
    totalCues: number;
    totalIssues: number;
    bySeverity: Record<string, number>;
    issues: Array<{ type: string; severity: string; cueIndex: number; message: string; suggestion?: string }>;
  } | null>(null);

  const handleCheck = async () => {
    if (!activeSubtitleId) {
      toast({ title: 'Chưa chọn phụ đề', variant: 'warning' });
      return;
    }
    try {
      const r = await mut.mutateAsync({ subtitleId: activeSubtitleId });
      setResult(r.data as typeof result);
      toast({ title: 'Đã kiểm tra', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kiểm tra nhất quán</CardTitle>
        <Button variant="primary" size="sm" onClick={handleCheck} loading={mut.isPending} disabled={!activeSubtitleId}>
          <CheckCircle2 size={12} />
          Kiểm tra
        </Button>
      </CardHeader>
      <CardContent>
        {!result ? (
          <EmptyState
            icon={<AlertTriangle size={36} />}
            title="Kiểm tra tên, địa danh, kỹ năng, thuật ngữ"
            description="Phát hiện glossary chưa áp dụng, lỗi thời gian, lỗi xuống dòng, lỗi chính tả"
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Tổng câu" value={result.totalCues} />
              <Stat label="Tổng vấn đề" value={result.totalIssues} variant={result.totalIssues > 0 ? 'error' : 'success'} />
              <Stat label="Lỗi" value={result.bySeverity.error || 0} variant="error" />
              <Stat label="Cảnh báo" value={result.bySeverity.warning || 0} variant="warning" />
            </div>
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {result.issues.length === 0 ? (
                <div className="text-center py-8 text-emerald-400 text-sm">
                  <CheckCircle2 size={36} className="mx-auto mb-2" />
                  Không có vấn đề gì!
                </div>
              ) : (
                result.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-2.5 rounded-md border ${
                      issue.severity === 'error'
                        ? 'bg-rose-500/5 border-rose-500/30'
                        : issue.severity === 'warning'
                        ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-blue-500/5 border-blue-500/30'
                    }`}
                  >
                    <Badge
                      variant={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}
                      size="sm"
                    >
                      {issue.type}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200">
                        <span className="text-zinc-500 mr-1">#{issue.cueIndex + 1}</span>
                        {issue.message}
                      </p>
                      {issue.suggestion && <p className="text-2xs text-emerald-400 mt-0.5">→ {issue.suggestion}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, variant = 'default' }: { label: string; value: number; variant?: 'default' | 'success' | 'error' | 'warning' }) {
  const colors = {
    default: 'text-zinc-200',
    success: 'text-emerald-400',
    error: 'text-rose-400',
    warning: 'text-amber-400',
  };
  return (
    <div className="rounded-md border border-[#2b2d31] bg-[#131416] p-2.5">
      <div className="text-2xs text-zinc-500 uppercase">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${colors[variant]}`}>{value}</div>
    </div>
  );
}

function GlossaryPanel() {
  const { activeChannelId, activeMovieId } = useAppStore();
  const { data: glossary = [], isLoading } = useGlossary({ channelId: activeChannelId || undefined, movieId: activeMovieId || undefined });
  const [original, setOriginal] = useState('');
  const [translated, setTranslated] = useState('');
  const [type, setType] = useState<'name' | 'place' | 'skill' | 'item' | 'title' | 'term' | 'other'>('name');

  const createMut = useCreateGlossaryEntry();
  const deleteMut = useDeleteGlossaryEntry();
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!original.trim() || !translated.trim()) {
      toast({ title: 'Thiếu thông tin', variant: 'error' });
      return;
    }
    try {
      await createMut.mutateAsync({
        original: original.trim(),
        translated: translated.trim(),
        type,
        channelId: activeChannelId || null,
        movieId: activeMovieId || null,
      });
      setOriginal('');
      setTranslated('');
      toast({ title: 'Đã thêm', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Từ điển</CardTitle>
        <Badge variant="violet" size="sm">{glossary.length} mục</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[1fr_1fr_140px_auto] gap-2 mb-4 p-3 rounded-md border border-[#2b2d31] bg-[#131416]">
          <Input
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            placeholder="十三"
            className="font-mono"
          />
          <Input
            value={translated}
            onChange={(e) => setTranslated(e.target.value)}
            placeholder="Thập Tam"
          />
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {GLOSSARY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
          <Button variant="primary" onClick={handleAdd} loading={createMut.isPending}>
            Thêm
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-zinc-500">Đang tải...</div>
        ) : glossary.length === 0 ? (
          <EmptyState icon={<Bot size={36} />} title="Từ điển trống" description="Thêm thuật ngữ để AI dịch nhất quán" />
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {glossary.map((g) => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[#2b2d31]/40 group">
                <Badge variant="default" size="sm">{GLOSSARY_TYPES.find((t) => t.value === g.type)?.label ?? g.type}</Badge>
                <span className="font-mono text-sm text-zinc-300 w-32">{g.original}</span>
                <span className="text-zinc-500">→</span>
                <span className="text-sm text-violet-300 flex-1">{g.translated}</span>
                {g.note && <span className="text-2xs text-zinc-500">{g.note}</span>}
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={async () => {
                    await deleteMut.mutateAsync(g.id);
                    toast({ title: 'Đã xóa', variant: 'success' });
                  }}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
