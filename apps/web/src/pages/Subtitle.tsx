import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Upload, Play, Pause, Zap, Save, Search, Replace, Undo, Redo,
  Download, Bot, CheckCircle2, AlertTriangle, Loader2, SkipForward, SkipBack,
} from 'lucide-react';
import {
  useEpisodes, useMovies, useChannels, useSubtitle, useImportSubtitle,
  useTranslateSubtitle, useUpdateCue, useUpdateSubtitle, useGlossary, useExportSubtitle,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, Button, Input, Textarea, Field, Dialog, Badge, EmptyState, Skeleton, Select, useToast, Tabs, TabsList, TabsTrigger, TabsContent,
} from '@sleiz/ui';
import { formatTimestamp, parseTimestamp, type SubtitleCue } from '@sleiz/shared';
import { useAppStore } from '../store/app';

function cueStatusLabel(status: SubtitleCue['status']): string {
  switch (status) {
    case 'pending': return 'Chờ dịch';
    case 'translated': return 'Đã dịch';
    case 'error': return 'Lỗi';
    case 'translating': return 'Đang dịch';
    case 'reviewed': return 'Đã soát';
    default: return status;
  }
}

export function SubtitlePage() {
  const navigate = useNavigate();
  const { activeChannelId, activeMovieId, activeEpisodeId, setActiveEpisode, setActiveSubtitle, activeSubtitleId } = useAppStore();
  const { data: channels = [] } = useChannels();
  const { data: movies = [] } = useMovies(activeChannelId || undefined);
  const { data: episodes = [] } = useEpisodes(activeMovieId || undefined);
  const { data: subtitle, isLoading } = useSubtitle(activeSubtitleId);
  const [importOpen, setImportOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);

  return (
    <PageContainer>
      <PageHeader
        title="Trình sửa phụ đề"
        description={subtitle ? `${subtitle.cues.length} câu phụ đề • ${subtitle.format.toUpperCase()}` : 'Chọn tập để mở phụ đề'}
        icon={<FileText size={18} />}
        actions={
          <>
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
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)} disabled={!activeEpisodeId}>
              <Upload size={14} />
              Nhập
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setTranslateOpen(true)}
              disabled={!subtitle || subtitle.cues.length === 0}
            >
              <Zap size={14} />
              Dịch
            </Button>
          </>
        }
      />
      <PageContent className="!p-0 !overflow-hidden flex flex-col">
        {!activeEpisodeId ? (
          <Card>
            <EmptyState
              icon={<FileText size={48} />}
              title="Chưa chọn tập"
              description="Chọn tập ở thanh công cụ để mở trình sửa phụ đề"
            />
          </Card>
        ) : isLoading ? (
          <Skeleton className="h-full" />
        ) : !subtitle ? (
          <Card>
            <EmptyState
              icon={<Upload size={48} />}
              title="Chưa có phụ đề"
              description="Nhập file SRT / VTT / ASS / TXT / CapCut JSON để bắt đầu"
              action={
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  <Upload size={14} />
                  Nhập phụ đề
                </Button>
              }
            />
          </Card>
        ) : (
          <SubtitleEditor subtitleId={subtitle.id} cues={subtitle.cues} />
        )}
      </PageContent>

      {importOpen && activeEpisodeId && (
        <ImportDialog episodeId={activeEpisodeId} onClose={() => setImportOpen(false)} onImported={(id) => { setActiveSubtitle(id); }} />
      )}
      {translateOpen && subtitle && (
        <TranslateDialog subtitleId={subtitle.id} onClose={() => setTranslateOpen(false)} />
      )}
    </PageContainer>
  );
}

// ============================================================================
// Subtitle Editor (VSCode-like)
// ============================================================================
function SubtitleEditor({ subtitleId, cues: initialCues }: { subtitleId: string; cues: SubtitleCue[] }) {
  const { toast } = useToast();
  const updateCueMut = useUpdateCue();
  const updateSubMut = useUpdateSubtitle();
  const [cues, setCues] = useState<SubtitleCue[]>(initialCues);
  const [selectedId, setSelectedId] = useState<string | null>(initialCues[0]?.id || null);
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'translated' | 'error'>('all');
  const [undoStack, setUndoStack] = useState<SubtitleCue[][]>([]);
  const [redoStack, setRedoStack] = useState<SubtitleCue[][]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedPlayerTime, setSelectedPlayerTime] = useState<number | null>(null);

  // Sync with server-side updates (e.g. after translation)
  useEffect(() => {
    setCues(initialCues);
  }, [initialCues]);

  const filtered = cues.filter((c) => {
    if (filter === 'pending' && c.status !== 'pending') return false;
    if (filter === 'translated' && c.status !== 'translated' && c.status !== 'reviewed') return false;
    if (filter === 'error' && c.status !== 'error') return false;
    if (search) {
      const q = search.toLowerCase();
      return c.textOriginal.toLowerCase().includes(q) || (c.textTranslated || '').toLowerCase().includes(q);
    }
    return true;
  });

  const selected = cues.find((c) => c.id === selectedId) || null;

  const pushUndo = useCallback(() => {
    setUndoStack((s) => [...s.slice(-50), cues]);
    setRedoStack([]);
  }, [cues]);

  const updateCueLocal = (id: string, patch: Partial<SubtitleCue>) => {
    pushUndo();
    setCues((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSubMut.mutateAsync({ id: subtitleId, cues });
      toast({ title: 'Đã lưu', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi lưu', description: err instanceof Error ? err.message : '', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceAll = () => {
    if (!search) return;
    pushUndo();
    setCues((cs) =>
      cs.map((c) => ({
        ...c,
        textTranslated: (c.textTranslated || '').replaceAll(search, replace),
      })),
    );
    toast({ title: 'Đã thay thế tất cả', variant: 'success' });
  };

  const undo = () => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => [...r, cues]);
      setCues(prev);
      return s.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((s) => {
      if (s.length === 0) return s;
      const next = s[s.length - 1];
      setUndoStack((u) => [...u, cues]);
      setCues(next);
      return s.slice(0, -1);
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Cue list (left, 50%) */}
      <div className="flex flex-col w-1/2 border-r border-[#2b2d31] min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#2b2d31] bg-[#131416]">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm..."
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Thay thế..."
            className="h-7 w-32 text-xs"
          />
          <Button variant="ghost" size="icon" title="Thay thế tất cả" onClick={handleReplaceAll} disabled={!search}>
            <Replace size={12} />
          </Button>
          <div className="w-px h-5 bg-[#2b2d31] mx-1" />
          <Button variant="ghost" size="icon" title="Hoàn tác (Ctrl+Z)" onClick={undo} disabled={undoStack.length === 0}>
            <Undo size={12} />
          </Button>
          <Button variant="ghost" size="icon" title="Làm lại (Ctrl+Y)" onClick={redo} disabled={redoStack.length === 0}>
            <Redo size={12} />
          </Button>
          <div className="w-px h-5 bg-[#2b2d31] mx-1" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-7 w-28 text-xs">
            <option value="all">Tất cả</option>
            <option value="pending">Chờ dịch</option>
            <option value="translated">Đã dịch</option>
            <option value="error">Lỗi</option>
          </Select>
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving} title="Lưu (Ctrl+S)">
            <Save size={12} />
            Lưu
          </Button>
        </div>

        {/* Cue list */}
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-zinc-500">Không có câu phụ đề nào</div>
          ) : (
            filtered.map((cue) => {
              const isSelected = cue.id === selectedId;
              return (
                <div
                  key={cue.id}
                  onClick={() => setSelectedId(cue.id)}
                  className={`px-3 py-2 border-b border-[#2b2d31] cursor-pointer transition-colors ${
                    isSelected ? 'bg-violet-500/15 border-l-2 border-l-violet-500' : 'hover:bg-[#2b2d31]/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xs text-zinc-500 tabular-nums">{String(cue.index + 1).padStart(3, '0')}</span>
                    <span className="text-2xs text-emerald-400">{formatTimestamp(cue.startMs)}</span>
                    <span className="text-2xs text-zinc-600">→</span>
                    <span className="text-2xs text-amber-400">{formatTimestamp(cue.endMs)}</span>
                    <div className="flex-1" />
                    {cue.status === 'translated' && <CheckCircle2 size={10} className="text-emerald-400" />}
                    {cue.status === 'error' && <AlertTriangle size={10} className="text-rose-400" />}
                    {cue.status === 'translating' && <Loader2 size={10} className="text-amber-400 animate-spin" />}
                  </div>
                  <div className="text-zinc-300 truncate">{cue.textOriginal}</div>
                  {cue.textTranslated && (
                    <div className="text-violet-300 truncate mt-0.5">{cue.textTranslated}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Detail editor (right) */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <CueEditor
            key={selected.id}
            cue={selected}
            onUpdate={(patch) => updateCueLocal(selected.id, patch)}
            onPrev={() => {
              const idx = cues.findIndex((c) => c.id === selected.id);
              if (idx > 0) setSelectedId(cues[idx - 1].id);
            }}
            onNext={() => {
              const idx = cues.findIndex((c) => c.id === selected.id);
              if (idx < cues.length - 1) setSelectedId(cues[idx + 1].id);
            }}
            onJumpToTime={(ms) => setSelectedPlayerTime(ms)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
            Chọn một câu phụ đề để chỉnh sửa
          </div>
        )}
      </div>
    </div>
  );
}

function CueEditor({
  cue,
  onUpdate,
  onPrev,
  onNext,
  onJumpToTime,
}: {
  cue: SubtitleCue;
  onUpdate: (patch: Partial<SubtitleCue>) => void;
  onPrev: () => void;
  onNext: () => void;
  onJumpToTime: (ms: number) => void;
}) {
  const [original, setOriginal] = useState(cue.textOriginal);
  const [translated, setTranslated] = useState(cue.textTranslated || '');
  const [startMs, setStartMs] = useState(formatTimestamp(cue.startMs));
  const [endMs, setEndMs] = useState(formatTimestamp(cue.endMs));

  // Sync when cue changes
  useEffect(() => {
    setOriginal(cue.textOriginal);
    setTranslated(cue.textTranslated || '');
    setStartMs(formatTimestamp(cue.startMs));
    setEndMs(formatTimestamp(cue.endMs));
  }, [cue.id, cue.textOriginal, cue.textTranslated, cue.startMs, cue.endMs]);

  const commit = () => {
    onUpdate({
      textOriginal: original,
      textTranslated: translated,
      startMs: parseTimestamp(startMs),
      endMs: parseTimestamp(endMs),
      status: translated ? 'reviewed' : 'pending',
    });
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2b2d31] bg-[#131416]">
        <div className="flex items-center gap-2">
          <Badge variant="violet" size="sm">#{cue.index + 1}</Badge>
          <Badge
            variant={cue.status === 'translated' || cue.status === 'reviewed' ? 'success' : cue.status === 'error' ? 'error' : 'default'}
            size="sm"
          >
            {cueStatusLabel(cue.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" title="Câu trước" onClick={onPrev}>
            <SkipBack size={14} />
          </Button>
          <Button variant="ghost" size="icon" title="Câu sau" onClick={onNext}>
            <SkipForward size={14} />
          </Button>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bắt đầu (HH:MM:SS,mmm)">
            <Input
              value={startMs}
              onChange={(e) => setStartMs(e.target.value)}
              className="font-mono text-xs"
              onBlur={commit}
            />
          </Field>
          <Field label="Kết thúc (HH:MM:SS,mmm)">
            <Input
              value={endMs}
              onChange={(e) => setEndMs(e.target.value)}
              className="font-mono text-xs"
              onBlur={commit}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onJumpToTime(cue.startMs)}>
            <Play size={12} />
            Nhảy tới timestamp
          </Button>
        </div>

        <Field label="Bản gốc (Trung)">
          <Textarea
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            className="font-mono text-sm min-h-[80px]"
            onBlur={commit}
          />
        </Field>

        <Field label="Bản dịch (Việt)">
          <Textarea
            value={translated}
            onChange={(e) => setTranslated(e.target.value)}
            className="font-mono text-sm min-h-[120px]"
            placeholder="Nhập bản dịch tiếng Việt..."
            onBlur={commit}
            autoFocus
          />
        </Field>

        {cue.speaker && (
          <Field label="Người nói">
            <Input value={cue.speaker} readOnly className="font-mono text-xs" />
          </Field>
        )}

        {cue.note && (
          <Field label="Ghi chú">
            <Input value={cue.note} readOnly className="text-xs" />
          </Field>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Import Dialog
// ============================================================================
function ImportDialog({
  episodeId,
  onClose,
  onImported,
}: {
  episodeId: string;
  onClose: () => void;
  onImported: (subtitleId: string) => void;
}) {
  const { toast } = useToast();
  const importMut = useImportSubtitle();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [language, setLanguage] = useState('zh');
  const [pasting, setPasting] = useState(false);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    const text = await file.text();
    setContent(text);
    setPasting(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!content || !filename) {
      toast({ title: 'Thiếu nội dung', description: 'Vui lòng chọn file hoặc paste nội dung', variant: 'error' });
      return;
    }
    try {
      const result = await importMut.mutateAsync({ episodeId, content, filename, language });
      toast({ title: 'Đã nhập phụ đề', description: `${result.data.cueCount} câu phụ đề`, variant: 'success' });
      onImported(result.data.id);
      onClose();
    } catch (err) {
      toast({ title: 'Lỗi nhập', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Nhập phụ đề"
      description="Hỗ trợ SRT, VTT, ASS, TXT, CapCut JSON"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={importMut.isPending} onClick={handleImport} disabled={!content}>
            <Upload size={14} />
            Nhập
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-[#3a3c41] rounded-lg p-6 text-center hover:border-violet-500/40 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,.ass,.ssa,.txt,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Upload size={28} className="mx-auto text-zinc-500 mb-2" />
          {filename ? (
            <p className="text-sm text-zinc-200">{filename}</p>
          ) : (
            <>
              <p className="text-sm text-zinc-300">Kéo thả file vào đây, hoặc click để chọn</p>
              <p className="text-2xs text-zinc-500 mt-1">SRT • VTT • ASS • TXT • CapCut JSON</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-[#2b2d31]" />
          <span className="text-2xs text-zinc-500">HOẶC</span>
          <div className="flex-1 h-px bg-[#2b2d31]" />
        </div>

        <Field label="Paste nội dung">
          <Textarea
            value={pasting ? content : ''}
            onChange={(e) => {
              setPasting(true);
              setContent(e.target.value);
              if (!filename) setFilename('pasted.srt');
            }}
            placeholder="00:01:23,456 --> 00:01:25,789&#10;你好世界"
            className="font-mono text-xs min-h-[120px]"
          />
        </Field>

        <Field label="Ngôn ngữ nguồn">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="zh">Trung</option>
            <option value="en">Anh</option>
            <option value="ja">Nhật</option>
            <option value="ko">Hàn</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

// ============================================================================
// Translate Dialog
// ============================================================================
function TranslateDialog({ subtitleId, onClose }: { subtitleId: string; onClose: () => void }) {
  const { toast } = useToast();
  const translateMut = useTranslateSubtitle();
  const exportMut = useExportSubtitle();
  const { activeChannelId, activeMovieId } = useAppStore();
  const { data: subtitle } = useSubtitle(subtitleId);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<{ translatedCues: number; fromMemory: number; tokensUsed: number; costUsd: number; durationMs: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'srt' | 'vtt' | 'ass' | 'txt' | 'json'>('srt');

  const handleTranslate = async () => {
    try {
      setProgress({ done: 0, total: 1 });
      const result = await translateMut.mutateAsync({
        subtitleId,
        provider: provider || undefined,
        model: model || undefined,
        channelId: activeChannelId || undefined,
        movieId: activeMovieId || undefined,
      });
      const data = result.data as { translatedCues: number; fromMemory: number; tokensUsed: number; costUsd: number; durationMs: number };
      setDone(data);
      toast({
        title: 'Dịch xong!',
        description: `${data.translatedCues} câu phụ đề (${data.fromMemory} từ bộ nhớ dịch), ${data.tokensUsed} tokens, $${data.costUsd.toFixed(4)}`,
        variant: 'success',
        duration: 8000,
      });
    } catch (err) {
      toast({ title: 'Lỗi dịch', description: err instanceof Error ? err.message : '', variant: 'error' });
    } finally {
      setProgress(null);
    }
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const r = await exportMut.mutateAsync({ subtitleId, format: downloadFormat });
      const { content, filename, mimeType } = r.data as { content: string; filename: string; mimeType: string };
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Đã tải ${downloadFormat.toUpperCase()}`, description: filename, variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi tải phụ đề', description: err instanceof Error ? err.message : '', variant: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  // Preview: first 6 translated cues
  const previewCues = (subtitle?.cues || [])
    .filter((c) => c.textTranslated)
    .slice(0, 6);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={done ? 'Dịch xong!' : 'Dịch bằng AI'}
      description={done ? 'Xem preview bên dưới, tải phụ đề hoặc đóng để quay lại trình sửa' : 'Hệ thống sẽ chia phụ đề thành batch 100 câu, dùng Bộ nhớ dịch và Từ điển'}
      className={done ? 'max-w-3xl' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{done ? 'Đóng' : 'Hủy'}</Button>
          {!done && (
            <Button variant="primary" loading={translateMut.isPending} onClick={handleTranslate}>
              <Zap size={14} />
              Bắt đầu dịch
            </Button>
          )}
          {done && (
            <div className="flex items-center gap-2 ml-auto">
              <Select
                value={downloadFormat}
                onChange={(e) => setDownloadFormat(e.target.value as typeof downloadFormat)}
                className="h-8 w-24 text-xs"
              >
                <option value="srt">SRT</option>
                <option value="vtt">VTT</option>
                <option value="ass">ASS</option>
                <option value="txt">TXT</option>
                <option value="json">JSON</option>
              </Select>
              <Button variant="primary" loading={downloading} onClick={handleDownload}>
                <Download size={14} />
                Tải phụ đề {downloadFormat.toUpperCase()}
              </Button>
            </div>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {/* === Trạng thái dịch xong: Preview + Download === */}
        {done && (
          <>
            <Card className="bg-emerald-500/5 border-emerald-500/30">
              <div className="p-3 text-xs text-emerald-200 space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={14} />
                  Dịch hoàn tất
                </div>
                <div className="text-2xs text-emerald-300/70 grid grid-cols-2 gap-1">
                  <span>• Câu đã dịch: <b>{done.translatedCues}</b></span>
                  <span>• Từ bộ nhớ dịch: <b>{done.fromMemory}</b></span>
                  <span>• Token dùng: <b>{done.tokensUsed}</b></span>
                  <span>• Chi phí: <b>${done.costUsd.toFixed(4)}</b></span>
                </div>
              </div>
            </Card>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-zinc-300 uppercase tracking-wider">Preview bản dịch (6 câu đầu)</h4>
                <span className="text-2xs text-zinc-500">{previewCues.length}/{subtitle?.cues.filter((c) => c.textTranslated).length || 0} câu hiển thị</span>
              </div>
              <div className="rounded-md border border-[#2b2d31] bg-[#131416] divide-y divide-[#2b2d31] max-h-[400px] overflow-y-auto">
                {previewCues.length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">Chưa có câu nào được dịch. Thử tải lại trang hoặc kiểm tra phụ đề.</div>
                ) : (
                  previewCues.map((cue) => (
                    <div key={cue.id} className="p-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xs text-zinc-500 tabular-nums">#{cue.index + 1}</span>
                        <span className="text-2xs text-emerald-400">{formatTimestamp(cue.startMs)}</span>
                        <span className="text-2xs text-zinc-600">→</span>
                        <span className="text-2xs text-amber-400">{formatTimestamp(cue.endMs)}</span>
                      </div>
                      <div className="text-xs text-zinc-400 truncate mb-0.5">{cue.textOriginal}</div>
                      <div className="text-sm text-violet-300">{cue.textTranslated}</div>
                    </div>
                  ))
                )}
              </div>
              <p className="text-2xs text-zinc-500 mt-2">
                Mở tab <b>Xuất</b> để xem full phụ đề + tải nhiều định dạng khác.
              </p>
            </div>
          </>
        )}

        {/* === Trạng thái đang dịch / chưa dịch === */}
        {!done && (
          <>
            {progress && (
              <Card className="bg-violet-500/5 border-violet-500/30">
                <div className="p-3 text-xs text-violet-200 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Đang dịch... {progress.done}/{progress.total}
                </div>
              </Card>
            )}
            <div className="text-xs text-zinc-400 space-y-1.5">
              <p>• Mỗi batch: 100 câu</p>
              <p>• Bộ nhớ dịch: bỏ qua câu đã dịch</p>
              <p>• Từ điển: ép buộc thuật ngữ theo từ điển</p>
              <p>• Nhà cung cấp mặc định lấy từ Cài đặt hoặc Kênh</p>
              <p>• Sau khi dịch xong sẽ có <b>preview</b> và <b>nút tải phụ đề</b> SRT/VTT/ASS/TXT/JSON</p>
            </div>
            <Field label="Nhà cung cấp (để trống = mặc định)">
              <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">— Mặc định —</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="claude">Anthropic Claude</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openrouter">OpenRouter</option>
                <option value="qwen">Qwen</option>
                <option value="local">Cục bộ (Ollama)</option>
              </Select>
            </Field>
            <Field label="Mô hình (để trống = mặc định)">
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gemini-2.0-flash-exp" />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
