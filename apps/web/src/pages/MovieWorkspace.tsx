import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Bot,
  Copy,
  Download,
  FileJson,
  FileText,
  Film,
  Loader2,
  Play,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  useAIDescription,
  useAIDescriptionByEpisode,
  useAISubtitleRewrite,
  useBatches,
  useEnsureMovieWorkspace,
  useExportSubtitle,
  useImportSubtitle,
  useMovieWorkspace,
  useResetSubtitleTranslation,
  useStartTranslateSubtitle,
  useTranslateSubtitleStatus,
  useUpdateSubtitle,
} from '../api/hooks';
import { useAppStore } from '../store/app';
import { PageContainer, PageContent, PageHeader } from '../components/Page';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@sleiz/ui';
import type { AIDescription, Batch, Episode, Movie, Subtitle, SubtitleCue } from '@sleiz/shared';

interface MovieWorkspaceData {
  movie: Movie;
  episode: Episode | null;
  subtitle: Subtitle | null;
  description: AIDescription | null;
  batches: Batch[];
}

function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function MovieWorkspacePage() {
  const params = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const movieId = params.movieId || null;
  const setActiveMovie = useAppStore((s) => s.setActiveMovie);
  const setActiveEpisode = useAppStore((s) => s.setActiveEpisode);
  const setActiveSubtitle = useAppStore((s) => s.setActiveSubtitle);
  const workspaceQuery = useMovieWorkspace(movieId);
  const ensureWorkspaceMut = useEnsureMovieWorkspace();
  const importMut = useImportSubtitle();
  const exportMut = useExportSubtitle();
  const translateMut = useStartTranslateSubtitle();
  const resetTranslationMut = useResetSubtitleTranslation();
  const rewriteMut = useAISubtitleRewrite();
  const updateSubtitleMut = useUpdateSubtitle();
  const [activeTab, setActiveTab] = useState('translate');
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('zh');
  const [instruction, setInstruction] = useState('Chỉnh câu chữ tự nhiên hơn, gọn hơn, hợp văn phong vietsub phim.');
  const [draftCues, setDraftCues] = useState<SubtitleCue[]>([]);
  const [resetTranslationOpen, setResetTranslationOpen] = useState(false);
  const [isPreparingImport, setIsPreparingImport] = useState(false);
  const [currentSubtitleId, setCurrentSubtitleId] = useState<string | null>(null);
  const previewListRef = useRef<HTMLDivElement>(null);
  const autoDownloadedRef = useRef<string | null>(null);
  const autoDescriptionRef = useRef<string | null>(null);

  const workspace = workspaceQuery.data as MovieWorkspaceData | undefined;
  const episodeId = workspace?.episode?.id || null;
  const workspaceSubtitleId = workspace?.subtitle?.id || null;
  // Keep the just-imported ID active while the workspace request catches up,
  // preventing its old subtitle batches from flashing back into the UI.
  const subtitleId = currentSubtitleId || workspaceSubtitleId;
  const descriptionQuery = useAIDescriptionByEpisode(episodeId);
  const descriptionMut = useAIDescription();
  const translationStatus = useTranslateSubtitleStatus(subtitleId, !!subtitleId);
  const batchesQuery = useBatches({ subtitleId: subtitleId || undefined });

  useEffect(() => {
    if (movieId) {
      setActiveMovie(movieId);
    }
  }, [movieId, setActiveMovie]);

  useEffect(() => {
    if (workspaceQuery.data && !workspace?.episode && !ensureWorkspaceMut.isPending && movieId) {
      ensureWorkspaceMut.mutate(movieId);
    }
  }, [ensureWorkspaceMut, movieId, workspace?.episode, workspaceQuery.data]);

  useEffect(() => {
    if (workspaceQuery.data) {
      setDraftCues(workspace?.subtitle?.cues ?? []);
    }
  }, [workspace?.subtitle?.id, workspace?.subtitle?.updatedAt, workspaceQuery.data]);

  // Change the query target immediately after an import instead of leaving
  // status and batch polling bound to the previous subtitle during refetch.
  useEffect(() => {
    if (workspaceSubtitleId) {
      setCurrentSubtitleId(workspaceSubtitleId);
    } else if (workspaceQuery.data) {
      setCurrentSubtitleId(null);
    }
  }, [workspaceQuery.data, workspaceSubtitleId]);

  // Realtime broadcasts update this query immediately. Poll more frequently
  // while translating as a fallback, so each saved batch appears in the
  // side-by-side preview without the user changing tabs or refreshing.
  useEffect(() => {
    if (!translationStatus.data?.running) return;
    const timer = window.setInterval(() => {
      workspaceQuery.refetch();
      batchesQuery.refetch();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batchesQuery, translationStatus.data?.running, workspaceQuery]);

  useEffect(() => {
    if (!subtitleId || !translationStatus.data?.done || autoDownloadedRef.current === subtitleId) {
      return;
    }

    autoDownloadedRef.current = subtitleId;
    exportMut.mutate(
      { subtitleId, format: 'srt', preferTranslated: true, translatedOnly: true },
      {
        onSuccess: (result) => {
          downloadTextFile(result.data.filename, result.data.content, result.data.mimeType);
          toast({
            title: 'Đã tự tải SRT',
            description: 'Bản dịch mới đã được tải xuống ngay khi hoàn tất.',
            variant: 'success',
          });
          if (episodeId) {
            autoDescriptionRef.current = null;
            triggerAutoDescription(episodeId);
          }
        },
      },
    );
  }, [episodeId, exportMut, subtitleId, toast, translationStatus.data?.done]);

  const triggerAutoDescription = (epId: string) => {
    if (!epId || autoDescriptionRef.current === epId) return;
    autoDescriptionRef.current = epId;
    descriptionMut.mutate(
      { episodeId: epId },
      {
        onSuccess: () => {
          toast({
            title: 'Đã sinh mô tả YouTube',
            description: 'Metadata được tạo tự động sau khi nạp phụ đề.',
            variant: 'success',
          });
          descriptionQuery.refetch();
        },
      },
    );
  };

  const batchRows = (batchesQuery.data || (subtitleId === workspaceSubtitleId ? workspace?.batches : []) || []) as Batch[];
  const failedBatch = batchRows.find((batch) => batch.status === 'failed');
  const description = (descriptionQuery.data || workspace?.description || null) as AIDescription | null;
  const translatedCount = useMemo(
    () => draftCues.filter((cue) => cue.textTranslated?.trim()).length,
    [draftCues],
  );
  const previewVirtualizer = useVirtualizer({
    count: draftCues.length,
    getScrollElement: () => previewListRef.current,
    estimateSize: () => 176,
    overscan: 6,
  });

  const handleSelectFile = (file: File) => {
    setFileName(file.name);
    setSelectedUploadFile(file);
    setFileContent('');
  };

  const handleImport = async () => {
    if (!workspace?.episode?.id || (!fileContent && !selectedUploadFile) || !fileName) {
      toast({ title: 'Thiếu dữ liệu', description: 'Hãy chọn file JSON hoặc SRT trước.', variant: 'error' });
      return;
    }

    setIsPreparingImport(true);
    let content: string;
    try {
      content = fileContent || await selectedUploadFile!.text();
    } catch (error) {
      setIsPreparingImport(false);
      toast({ title: 'Không thể đọc file', description: error instanceof Error ? error.message : '', variant: 'error' });
      return;
    }

    importMut.mutate(
      {
        episodeId: workspace.episode.id,
        content,
        filename: fileName,
        language,
      },
      {
        onSuccess: async (result) => {
          setIsPreparingImport(false);
          autoDownloadedRef.current = null;
          setCurrentSubtitleId(result.data.id);
          toast({
            title: 'Đã nạp phụ đề',
            description: `${result.data.cueCount} dòng từ ${result.data.format.toUpperCase()}. Đang tự động bắt đầu dịch.`,
            variant: 'success',
          });
          await workspaceQuery.refetch();
          translateMut.mutate(
            {
              subtitleId: result.data.id,
              provider: 'gemini',
              channelId: workspace.movie?.channelId,
              movieId: workspace.movie?.id,
              batchSize: 100,
            },
            {
              onError: (error) => {
                toast({ title: 'Không thể tự động bắt đầu dịch', description: error instanceof Error ? error.message : '', variant: 'error' });
              },
            },
          );
        },
        onError: (error) => {
          setIsPreparingImport(false);
          toast({ title: 'Lỗi nạp phụ đề', description: error instanceof Error ? error.message : '', variant: 'error' });
        },
      },
    );
  };

  const handleTranslate = async () => {
    if (!subtitleId || !workspace?.movie?.channelId || !workspace?.movie?.id) return;
    translateMut.mutate(
      {
        subtitleId,
        provider: 'gemini',
        channelId: workspace.movie.channelId,
        movieId: workspace.movie.id,
        batchSize: 100,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Đã bắt đầu dịch',
            description: 'Phụ đề đang được xử lý theo từng batch 100 dòng.',
            variant: 'info',
          });
        },
        onError: (error) => {
          toast({ title: 'Lỗi dịch', description: error instanceof Error ? error.message : '', variant: 'error' });
        },
      },
    );
  };

  const handleResetTranslation = () => {
    if (!subtitleId) return;
    resetTranslationMut.mutate(subtitleId, {
      onSuccess: () => {
        setResetTranslationOpen(false);
        // `updatedAt` has second precision. Clear the local preview right
        // away so a fast reset/start cannot retain the former count in UI.
        setDraftCues((current) => current.map((cue) => ({
          ...cue,
          textTranslated: '',
          status: 'pending',
        })));
        autoDownloadedRef.current = null;
        toast({ title: 'Đã xóa phiên dịch hiện tại', description: 'Đã xóa bản dịch và batch; phụ đề gốc cùng timecode được giữ nguyên.', variant: 'success' });
        translationStatus.refetch();
        batchesQuery.refetch();
        workspaceQuery.refetch();
      },
      onError: (error) => toast({ title: 'Không thể xóa phiên dịch', description: error instanceof Error ? error.message : '', variant: 'error' }),
    });
  };

  const handleGenerateDescription = async () => {
    if (!episodeId) return;
    descriptionMut.mutate(
      { episodeId },
      {
        onSuccess: () => {
          toast({ title: 'Đã tạo mô tả YouTube', variant: 'success' });
          descriptionQuery.refetch();
        },
      },
    );
  };

  const handleDownloadTranslatedSubtitle = () => {
    if (!subtitleId) return;
    exportMut.mutate(
      { subtitleId, format: 'srt', preferTranslated: true, translatedOnly: true },
      {
        onSuccess: (result) => {
          downloadTextFile(result.data.filename, result.data.content, result.data.mimeType);
          toast({ title: 'Đã tải phụ đề đã dịch', variant: 'success' });
        },
      },
    );
  };

  const handlePreviewVideo = () => {
    if (!workspace?.episode || !subtitleId) return;
    setActiveMovie(workspace.movie.id);
    setActiveEpisode(workspace.episode.id);
    setActiveSubtitle(subtitleId);
    navigate('/video');
  };

  const descriptionText = useMemo(() => {
    if (!description) return '';
    const body = description.youtubeDescription?.trim() || '';
    const hashtags = description.hashtags?.trim() || '';
    if (!hashtags || body.includes(hashtags)) return body;
    return `${body}${body ? '\n\n━━━━━━━━━━━━━━━━━━━━━━\n🏷️ Hashtag:\n' : ''}${hashtags}`;
  }, [description]);

  const handleCopyDescription = async () => {
    if (!descriptionText) return;
    try {
      await navigator.clipboard.writeText(descriptionText);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = descriptionText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    toast({ title: 'Đã copy mô tả YouTube', variant: 'success' });
  };

  const handleRewrite = async () => {
    if (!subtitleId || !instruction.trim()) return;
    rewriteMut.mutate(
      { subtitleId, instruction },
      {
        onSuccess: () => {
          toast({ title: 'AI đã chỉnh lại phụ đề', variant: 'success' });
          workspaceQuery.refetch();
        },
        onError: (error) => {
          toast({ title: 'Lỗi chỉnh sửa', description: error instanceof Error ? error.message : '', variant: 'error' });
        },
      },
    );
  };

  const handleSaveDraft = async () => {
    if (!subtitleId) return;
    updateSubtitleMut.mutate(
      { id: subtitleId, cues: draftCues },
      {
        onSuccess: () => {
          toast({ title: 'Đã lưu phụ đề', variant: 'success' });
          workspaceQuery.refetch();
        },
      },
    );
  };

  if (workspaceQuery.isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Bộ phim" icon={<Film size={18} />} />
        <PageContent>
          <Skeleton className="h-[540px]" />
        </PageContent>
      </PageContainer>
    );
  }

  if (!workspace) {
    return (
      <PageContainer>
        <PageHeader title="Bộ phim" icon={<Film size={18} />} />
        <PageContent>
          <Card>
            <EmptyState
              icon={<Film size={48} />}
              title="Không tìm thấy bộ phim"
              description="Bộ phim đã bị xóa hoặc chưa tồn tại."
              action={
                <Button variant="primary" onClick={() => navigate('/movies')}>
                  Quay lại danh sách phim
                </Button>
              }
            />
          </Card>
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={workspace.movie.titleVi}
        description={`${workspace.movie.titleZh} • Workspace dịch phim`}
        icon={<Film size={18} />}
        actions={
          <>
            <Badge variant="violet" size="sm">{workspace.subtitle?.format?.toUpperCase() || 'Chưa nạp phụ đề'}</Badge>
            <Badge variant="default" size="sm">{translatedCount}/{draftCues.length || 0} dòng đã có bản dịch</Badge>
          </>
        }
      />
      <PageContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="translate">Dịch Phim</TabsTrigger>
            <TabsTrigger value="edit">Chỉnh Sửa Phụ Đề</TabsTrigger>
          </TabsList>

          <TabsContent value="translate" className="mt-4 space-y-4">
            <Card>
              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3">
                  <Field label="Nạp JSON / SRT">
                    <div className="rounded-lg border border-dashed border-[#3a3c41] p-4">
                      <input
                        type="file"
                        accept=".json,.srt,.vtt,.ass,.ssa,.txt"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleSelectFile(file);
                        }}
                        className="mb-3 block w-full text-xs text-zinc-400 file:mr-4 file:rounded-md file:border-0 file:bg-violet-500/20 file:px-3 file:py-2 file:text-xs file:text-violet-200"
                      />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <Badge variant="default" size="sm">
                          {fileName?.endsWith('.json') ? <FileJson size={12} /> : <FileText size={12} />}
                          {fileName || 'Chưa chọn file'}
                        </Badge>
                        <Badge variant="default" size="sm">{language.toUpperCase()}</Badge>
                      </div>
                    </div>
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                    <Field label="Ngôn ngữ nguồn">
                      <Input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="zh" />
                    </Field>
                    <Field label="Nội dung đã nạp">
                      <Textarea
                        value={fileContent}
                        onChange={(event) => {
                          if (selectedUploadFile) setFileName('pasted-subtitle.srt');
                          setSelectedUploadFile(null);
                          if (!fileName) setFileName('pasted-subtitle.srt');
                          setFileContent(event.target.value);
                        }}
                        className="min-h-[160px] font-mono text-xs"
                        placeholder={selectedUploadFile ? 'File đã sẵn sàng để nạp. Dán nội dung tại đây sẽ thay thế file đã chọn.' : 'Dán JSON hoặc SRT vào đây nếu không chọn file.'}
                      />
                    </Field>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={handleImport} loading={importMut.isPending || isPreparingImport} disabled={isPreparingImport}>
                      <Upload size={14} />
                      Nạp phụ đề
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleTranslate}
                      disabled={!subtitleId}
                      loading={translateMut.isPending || translationStatus.data?.running}
                    >
                      <Zap size={14} />
                      Dịch bằng Gemini
                    </Button>
                    {subtitleId && (translatedCount > 0 || batchRows.length > 0) && (
                      <Button variant="secondary" className="border border-red-500/70 !text-red-300 hover:!bg-red-500/15" onClick={() => setResetTranslationOpen(true)}>
                        <Trash2 size={14} />
                        Xóa phiên dịch
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={handleGenerateDescription}
                      disabled={!episodeId}
                      loading={descriptionMut.isPending}
                    >
                      <Sparkles size={14} />
                      Tạo mô tả YouTube
                    </Button>
                    {translationStatus.data?.done && (
                      <>
                        <Button variant="primary" onClick={handleDownloadTranslatedSubtitle} loading={exportMut.isPending}>
                          <Download size={14} />
                          Tải phụ đề đã dịch
                        </Button>
                        <Button variant="secondary" onClick={handlePreviewVideo}>
                          <Play size={14} />
                          Xem trước video
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <Card className="bg-[#131416]">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Tiến độ dịch</span>
                        <span className="text-zinc-100">
                          {translationStatus.data?.completedBatches || 0}/{translationStatus.data?.totalBatches || batchRows.length || 0} batch
                        </span>
                      </div>
                      <div className="rounded-full bg-[#0b0b0d] h-2 overflow-hidden">
                        <div
                          className="h-full bg-violet-500 transition-all"
                          style={{
                            width: `${translationStatus.data?.totalBatches ? (translationStatus.data.completedBatches / translationStatus.data.totalBatches) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="text-xs text-zinc-500">
                        Mỗi batch xử lý 100 dòng. Khi hoàn tất hệ thống sẽ tự tải SRT mới.
                      </div>
                      {(translationStatus.data?.failedBatches || 0) > 0 && (
                        <div className="text-xs text-red-400">
                          {failedBatch?.error || 'Một batch chưa hoàn tất. Bấm “Dịch bằng Gemini” để hệ thống chỉ thử lại các dòng lỗi.'}
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card className="bg-[#131416]">
                    <div className="space-y-2 text-xs text-zinc-400">
                      <div className="flex items-center justify-between">
                        <span>Trạng thái</span>
                        <Badge variant={translationStatus.data?.running ? 'warning' : 'default'} size="sm">
                          {translationStatus.data?.running ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              Đang xử lý
                            </>
                          ) : (
                            (translationStatus.data?.failedBatches || 0) > 0
                              ? 'Dịch thất bại'
                              : workspace.episode?.status || 'pending'
                          )}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Phụ đề</span>
                        <span>{workspace.subtitle?.cues.length || 0} dòng</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Bản dịch</span>
                        <span>{translatedCount} dòng</span>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </Card>

            <Card>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-violet-300" />
                    <h3 className="text-sm font-semibold text-zinc-100">SRT gốc và bản dịch trực tiếp</h3>
                  </div>
                  <Badge variant={translationStatus.data?.running ? 'warning' : 'default'} size="sm">
                    {translationStatus.data?.running ? (
                      <><Loader2 size={12} className="animate-spin" /> Cập nhật theo thời gian thực</>
                    ) : (
                      `${translatedCount}/${draftCues.length} dòng đã dịch`
                    )}
                  </Badge>
                </div>
                {draftCues.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={40} />}
                    title="Chưa có phụ đề để hiển thị"
                    description="Nạp file SRT/JSON trước; sau đó bản gốc và từng dòng đang dịch sẽ xuất hiện tại đây."
                  />
                ) : (
                  <div ref={previewListRef} className="max-h-[620px] overflow-y-auto pr-1">
                    <div style={{ height: `${previewVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                    {previewVirtualizer.getVirtualItems().map((virtualRow) => {
                      const cue = draftCues[virtualRow.index];
                      const translated = cue.textTranslated?.trim();
                      const failed = cue.status === 'error';
                      return (
                        <div
                          key={cue.id}
                          ref={previewVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full pb-2"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <div className="rounded-lg border border-[#2b2d31] p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                            <Badge variant="default" size="sm">#{cue.index + 1}</Badge>
                            <span>{cue.startMs}ms - {cue.endMs}ms</span>
                            {translated ? (
                              <Badge variant="success" size="sm">Đã dịch</Badge>
                            ) : failed ? (
                              <Badge variant="error" size="sm">Lỗi dịch</Badge>
                            ) : (
                              <Badge variant="warning" size="sm">{translationStatus.data?.running ? 'Đang dịch…' : 'Chưa dịch'}</Badge>
                            )}
                          </div>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="rounded-md bg-[#0b0b0d] p-3">
                              <p className="mb-1 text-xs font-medium text-zinc-500">SRT gốc</p>
                              <p className="whitespace-pre-wrap text-sm text-zinc-200">{cue.textOriginal}</p>
                            </div>
                            <div className="rounded-md bg-violet-500/5 p-3">
                              <p className="mb-1 text-xs font-medium text-violet-300">SRT đang dịch</p>
                              <p className={translated ? 'whitespace-pre-wrap text-sm text-zinc-100' : 'text-sm italic text-zinc-500'}>
                                {translated || (failed ? 'Không thể dịch dòng này. Xem batch lỗi và chạy lại.' : 'Đang chờ dịch…')}
                              </p>
                            </div>
                          </div>
                        </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-violet-300" />
                  <h3 className="text-sm font-semibold text-zinc-100">Tiến độ từng batch</h3>
                </div>
                {batchRows.length === 0 ? (
                  <EmptyState
                    icon={<Zap size={40} />}
                    title="Chưa có batch nào"
                    description="Sau khi bấm Dịch bằng Gemini, danh sách batch 100 dòng sẽ hiện ở đây."
                  />
                ) : (
                  <div className="space-y-2">
                    {batchRows.map((batch) => {
                      const percent = batch.totalCues ? Math.round((batch.processedCues / batch.totalCues) * 100) : 0;
                      return (
                        <div key={batch.id} className="rounded-lg border border-[#2b2d31] p-3">
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="default" size="sm">Batch {batch.batchIndex + 1}</Badge>
                              <span className="text-zinc-400">
                                Dòng {batch.startCue + 1}-{batch.endCue}
                              </span>
                            </div>
                            <Badge variant={batch.status === 'completed' ? 'success' : batch.status === 'running' ? 'warning' : batch.status === 'failed' ? 'error' : 'default'} size="sm">
                              {batch.status}
                            </Badge>
                          </div>
                          <div className="rounded-full bg-[#0b0b0d] h-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
                          </div>
                          <div className="mt-2 text-xs text-zinc-500">
                            {batch.processedCues}/{batch.totalCues} dòng
                          </div>
                          {batch.error && (
                            <p className="mt-2 whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-300">
                              {batch.error}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-violet-300" />
                  <h3 className="text-sm font-semibold text-zinc-100">Mô tả YouTube</h3>
                </div>
                {!description ? (
                  <EmptyState
                    icon={<Sparkles size={40} />}
                    title="Chưa có mô tả"
                    description="Mô tả sẽ được sinh tự động ngay khi nạp JSON/SRT, hoặc bạn có thể bấm tạo lại."
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-zinc-500">Mô tả hoàn chỉnh, bao gồm nội dung và hashtag.</p>
                      <Button variant="secondary" size="sm" onClick={handleCopyDescription}>
                        <Copy size={14} />
                        Copy mô tả
                      </Button>
                    </div>
                    <Textarea value={descriptionText} readOnly className="min-h-[420px]" />
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="edit" className="mt-4 space-y-4">
            {!workspace.subtitle ? (
              <Card>
                <EmptyState
                  icon={<Wand2 size={40} />}
                  title="Chưa có phụ đề để chỉnh"
                  description="Hãy nạp JSON hoặc SRT trong tab Dịch Phim trước."
                />
              </Card>
            ) : (
              <>
                <Card>
                  <div className="space-y-3">
                    <Field label="Yêu cầu cho AI">
                      <Textarea
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                        className="min-h-[100px]"
                        placeholder="Ví dụ: sửa câu văn mềm mại hơn, thống nhất cách xưng hô, rút gọn câu quá dài."
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={handleRewrite} loading={rewriteMut.isPending}>
                        <Wand2 size={14} />
                        AI chỉnh lại phụ đề
                      </Button>
                      <Button variant="secondary" onClick={handleSaveDraft} loading={updateSubtitleMut.isPending}>
                        <Save size={14} />
                        Lưu chỉnh sửa tay
                      </Button>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-100">Danh sách phụ đề</h3>
                      <span className="text-xs text-zinc-500">{draftCues.length} dòng</span>
                    </div>
                    <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                      {draftCues.map((cue, index) => (
                        <div key={cue.id} className="rounded-lg border border-[#2b2d31] p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                            <Badge variant="default" size="sm">#{cue.index + 1}</Badge>
                            <span>{cue.startMs}ms - {cue.endMs}ms</span>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <Field label="Bản gốc">
                              <Textarea value={cue.textOriginal} readOnly className="min-h-[88px] font-mono text-xs" />
                            </Field>
                            <Field label="Bản dịch">
                              <Textarea
                                value={cue.textTranslated || ''}
                                onChange={(event) => {
                                  setDraftCues((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, textTranslated: event.target.value, status: 'reviewed' }
                                        : item,
                                    ),
                                  );
                                }}
                                className="min-h-[88px] font-mono text-xs"
                              />
                            </Field>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PageContent>
      <ConfirmDialog
        open={resetTranslationOpen}
        onOpenChange={setResetTranslationOpen}
        title="Xóa phiên dịch hiện tại?"
        description="Toàn bộ bản dịch và lịch sử batch của phụ đề này sẽ bị xóa. SRT gốc và timecode được giữ nguyên."
        onConfirm={handleResetTranslation}
      />
    </PageContainer>
  );
}
