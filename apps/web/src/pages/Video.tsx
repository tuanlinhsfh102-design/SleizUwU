/**
 * Video Translation Pipeline Page
 *
 * End-to-end flow:
 *   upload video → audio→SRT (CapCut STT) → translate zh→vi (Gemini) →
 *   SRT→audio (TikTok TTS) → blur original text + burn vietsub + add logo +
 *   crop 16:9 (FFmpeg) → final preview
 *
 * Layout: 3-column
 *   [left]  upload + config panel
 *   [center] video preview (tabs: Original / Final)
 *   [right] active job progress + history list
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Play, Pause, Upload, FileVideo, Volume2, SkipForward, SkipBack,
  Mic2, ImageIcon, Sparkles, Wand2, Loader2, Check, X,
  RefreshCw, Trash2, Film, Crop, Layers, Eye, Settings, Download,
  AlertCircle, Clock, ArrowRight, Link as LinkIcon,
} from 'lucide-react';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, Button, Input, Field, Badge, EmptyState, Select, useToast,
} from '@sleiz/ui';
import { formatTimestamp } from '@sleiz/shared';
import {
  useVideoTranslateJobs,
  useVideoTranslateJobStatus,
  useUploadVideoTranslateVideo,
  useUploadVideoTranslateLogo,
  useCreateVideoTranslateJob,
  useStartVideoTranslateJob,
  useCancelVideoTranslateJob,
  useRetryVideoTranslateJob,
  useDeleteVideoTranslateJob,
  useProbeVideo,
  useTiktokDownload,
  type VideoTranslateJob,
  type VideoTranslateJobStatus,
  type VideoMetadataInfo,
} from '../api/hooks';

// ============================================================================
// Constants
// ============================================================================

interface PipelineStep {
  key: string;
  label: string;
  icon: typeof Film;
  hint: string;
}

const PIPELINE_STEPS: PipelineStep[] = [
  { key: 'queued',            label: 'Hàng đợi',                       icon: Layers,    hint: 'Chờ khởi động pipeline' },
  { key: 'extracting_audio',  label: 'Tách âm thanh gốc',              icon: Film,      hint: 'FFmpeg → MP3 192kbps' },
  { key: 'transcribing',      label: 'STT: Audio → SRT (Trung)',       icon: Mic2,      hint: 'CapCut STT API' },
  { key: 'translating',       label: 'Dịch: Trung → Việt',             icon: Sparkles,  hint: 'Gemini AI batch dịch' },
  { key: 'generating_tts',    label: 'TTS: SRT → Audio (Việt)',        icon: Volume2,   hint: 'TikTok TTSBV074/075' },
  { key: 'processing_video',  label: 'Render: blur + sub + logo + crop', icon: Wand2,  hint: 'FFmpeg filter complex' },
  { key: 'completed',         label: 'Hoàn tất',                       icon: Check,     hint: 'Video sẵn sàng tải về' },
];

const VOICES = [
  { value: 'BV074_streaming', label: 'Nữ — TikTok BV074' },
  { value: 'BV075_streaming', label: 'Nam — TikTok BV075' },
];

const LOGO_POSITIONS = [
  { value: 'top-right',    label: 'Trên — phải' },
  { value: 'top-left',     label: 'Trên — trái' },
  { value: 'bottom-right', label: 'Dưới — phải' },
  { value: 'bottom-left',  label: 'Dưới — trái' },
];

// ============================================================================
// Main component
// ============================================================================

export function VideoPage() {
  // ----- Config state -----
  const [videoFileName, setVideoFileName] = useState<string>('');
  const [videoUrl, setVideoUrl] = useState<string>('');           // /uploads/... for preview
  const [videoPath, setVideoPath] = useState<string>('');         // absolute path for backend
  const [videoSize, setVideoSize] = useState<number>(0);

  // TikTok URL import state
  const [tiktokUrl, setTiktokUrl] = useState<string>('');
  const [tiktokInfo, setTiktokInfo] = useState<{ title: string; author: string; cover?: string } | null>(null);

  const [logoUrl, setLogoUrl] = useState<string>('/api/video-translate/default-logo');
  const [logoPath, setLogoPath] = useState<string>('');           // empty = use default
  const [logoFileName, setLogoFileName] = useState<string>('Sleiz Vietsub (mặc định)');
  const [logoEnabled, setLogoEnabled] = useState<boolean>(true);   // toggle on/off

  const [voice, setVoice] = useState<string>('BV074_streaming');
  const [cropTo16x9, setCropTo16x9] = useState<boolean>(true);
  const [blurIntensity, setBlurIntensity] = useState<number>(20);
  // Logo position is fixed at top-right per user requirement.
  const logoPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' = 'top-right';
  const [logoScale, setLogoScale] = useState<number>(0.15);

  // ----- Audio settings -----
  const [ttsSpeed, setTtsSpeed] = useState<number>(1.0);          // 0.5–2.0
  const [ttsVolume, setTtsVolume] = useState<number>(1.0);        // 0.0–3.0
  const [originalAudioMode, setOriginalAudioMode] = useState<'replace' | 'mix'>('replace');
  const [originalAudioVolume, setOriginalAudioVolume] = useState<number>(0.15); // 0.0–1.0

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'original' | 'output'>('original');
  // Preview mode toggle: when on, overlays crop guide / logo / blur region
  // on top of the HTML5 video so the user can see what the export will look
  // like without waiting for the full pipeline to run. CapCut-style.
  const [previewMode, setPreviewMode] = useState<boolean>(true);

  // Probe video metadata (real dimensions) so preview overlays are pixel-accurate.
  const videoMeta = useProbeVideo(videoPath || null);

  // ----- API -----
  const { toast } = useToast();
  const jobsQuery = useVideoTranslateJobs();
  const jobs: VideoTranslateJob[] = jobsQuery.data ?? [];

  const activeJobStatus = useVideoTranslateJobStatus(
    activeJobId,
    // Poll only while job is queued or processing
    !!activeJobId,
  );

  // Auto-stop polling and switch tab on completion
  useEffect(() => {
    if (!activeJobStatus.data) return;
    const s = activeJobStatus.data;
    if (s.status === 'completed' && s.outputVideoUrl) {
      setPreviewTab('output');
    }
    if (s.status === 'completed' || s.status === 'failed') {
      // refetch jobs list once
      jobsQuery.refetch();
    }
  }, [activeJobStatus.data?.status, activeJobStatus.data?.outputVideoUrl]);

  const uploadVideoMut   = useUploadVideoTranslateVideo();
  const uploadLogoMut    = useUploadVideoTranslateLogo();
  const tiktokDownloadMut = useTiktokDownload();
  const createJobMut     = useCreateVideoTranslateJob();
  const startJobMut      = useStartVideoTranslateJob();
  const cancelJobMut     = useCancelVideoTranslateJob();
  const retryJobMut      = useRetryVideoTranslateJob();
  const deleteJobMut     = useDeleteVideoTranslateJob();

  // ----- Handlers -----
  const handleVideoUpload = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name)) {
      toast({ title: 'Sai định dạng', description: 'Chỉ nhận MP4, MOV, MKV, WEBM, M4V, AVI.', variant: 'error' });
      return;
    }
    try {
      const res = await uploadVideoMut.mutateAsync(file);
      if (!res?.ok || !res.data) throw new Error('Upload thất bại');
      setVideoUrl(res.data.url);
      setVideoPath(res.data.absolutePath);
      setVideoFileName(res.data.fileName);
      setVideoSize(res.data.size);
      toast({
        title: 'Đã tải video lên',
        description: `${res.data.fileName} (${(res.data.size / 1024 / 1024).toFixed(1)} MB)`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Không thể tải video',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  }, [uploadVideoMut, toast]);

  // Download a TikTok video by URL and load it into the pipeline.
  // The downloaded file lives in the tiktok storage dir (outside /uploads),
  // so we use the /api/video-translate/serve endpoint to stream it back to
  // the browser for preview, and pass the absolute path to the backend
  // when creating the translation job (resolveStoragePath handles it).
  const handleTiktokDownload = useCallback(async () => {
    const url = tiktokUrl.trim();
    if (!url) {
      toast({ title: 'Thiếu URL', description: 'Nhập link TikTok trước.', variant: 'error' });
      return;
    }
    if (!/tiktok\.com\//i.test(url)) {
      toast({ title: 'Sai link', description: 'URL phải chứa tiktok.com', variant: 'error' });
      return;
    }
    try {
      const res = await tiktokDownloadMut.mutateAsync({ url });
      if (!res?.data) throw new Error('Tải thất bại');
      const downloadedPath = res.data.filePath;
      const info = res.data.info;
      setTiktokInfo({ title: info.title, author: info.author, cover: info.cover });

      // Use the /serve endpoint to preview the downloaded file in the
      // <video> element. The backend's resolveStoragePath() will resolve
      // the absolute path when the job is created.
      setVideoPath(downloadedPath);
      setVideoUrl(`/api/video-translate/serve?path=${encodeURIComponent(downloadedPath)}`);
      setVideoFileName(`${info.title || 'tiktok-video'}.mp4`);
      setVideoSize(res.data.fileSize);

      toast({
        title: 'Đã tải video TikTok',
        description: `${info.title} — ${info.author} (${(res.data.fileSize / 1024 / 1024).toFixed(1)} MB)`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Không thể tải TikTok',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  }, [tiktokUrl, tiktokDownloadMut, toast]);

  const handleLogoUpload = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && !/\.(png|jpg|jpeg|webp|gif)$/i.test(file.name)) {
      toast({ title: 'Sai định dạng', description: 'Logo phải là PNG, JPG, WEBP hoặc GIF.', variant: 'error' });
      return;
    }
    try {
      const res = await uploadLogoMut.mutateAsync(file);
      if (!res?.ok || !res.data) throw new Error('Upload thất bại');
      setLogoUrl(res.data.url);
      setLogoPath(res.data.absolutePath);
      setLogoFileName(res.data.fileName);
      setLogoEnabled(true); // auto-enable logo when user uploads a new one
      toast({
        title: 'Đã tải logo lên',
        description: res.data.fileName,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Không thể tải logo',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  }, [uploadLogoMut, toast]);

  const handleUseDefaultLogo = useCallback(() => {
    setLogoUrl('/api/video-translate/default-logo');
    setLogoPath('');
    setLogoFileName('Sleiz Vietsub (mặc định)');
    setLogoEnabled(true);
  }, []);

  const canStartPipeline = !!videoPath && !createJobMut.isPending && !startJobMut.isPending;

  const handleStartPipeline = useCallback(async () => {
    if (!videoPath) {
      toast({ title: 'Thiếu video', description: 'Hãy tải lên video gốc trước.', variant: 'error' });
      return;
    }
    try {
      // When logo is enabled but no custom logo was uploaded, fall back to
      // the default Sleiz Vietsub logo served at /api/video-translate/default-logo.
      // The backend resolves this URL to the absolute path of the default PNG.
      const effectiveLogoPath = logoEnabled
        ? (logoPath || '/api/video-translate/default-logo')
        : undefined;
      const createRes = await createJobMut.mutateAsync({
        videoPath,
        voice,
        logoPath: effectiveLogoPath,
        cropTo16x9,
        blurIntensity,
        logoPosition, // always 'top-right'
        logoScale,
        // Audio settings
        ttsSpeed,
        ttsVolume,
        originalAudioMode,
        originalAudioVolume,
      });
      const jobId = createRes.data.id;
      setActiveJobId(jobId);
      setPreviewTab('original');
      await startJobMut.mutateAsync(jobId);
      toast({
        title: 'Đã khởi động pipeline',
        description: 'Đang xử lý. Theo dõi tiến độ ở bảng bên phải.',
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Không thể khởi động',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    }
  }, [
    videoPath, voice, logoPath, logoEnabled, cropTo16x9, blurIntensity, logoPosition, logoScale,
    ttsSpeed, ttsVolume, originalAudioMode, originalAudioVolume,
    createJobMut, startJobMut, toast,
  ]);

  const handleCancelJob = useCallback(async () => {
    if (!activeJobId) return;
    try {
      await cancelJobMut.mutateAsync(activeJobId);
      toast({ title: 'Đã huỷ job', variant: 'success' });
    } catch (err) {
      toast({ title: 'Không thể huỷ', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  }, [activeJobId, cancelJobMut, toast]);

  const handleRetryJob = useCallback(async (jobId: string) => {
    try {
      await retryJobMut.mutateAsync(jobId);
      setActiveJobId(jobId);
      await startJobMut.mutateAsync(jobId);
      toast({ title: 'Đang chạy lại', variant: 'success' });
    } catch (err) {
      toast({ title: 'Không thể chạy lại', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  }, [retryJobMut, startJobMut, toast]);

  const handleDeleteJob = useCallback(async (jobId: string) => {
    try {
      await deleteJobMut.mutateAsync(jobId);
      if (activeJobId === jobId) setActiveJobId(null);
      toast({ title: 'Đã xoá job', variant: 'success' });
    } catch (err) {
      toast({ title: 'Không thể xoá', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  }, [activeJobId, deleteJobMut, toast]);

  const handleLoadJob = useCallback((job: VideoTranslateJob) => {
    setActiveJobId(job.id);
    if (job.status === 'completed' && job.outputVideoUrl) {
      setPreviewTab('output');
    } else {
      setPreviewTab('original');
    }
  }, []);

  // The "active" job for the right-hand panel — either the live status poll
  // (if user just started one) or the most recent job from the list.
  const activeJobForPanel: VideoTranslateJob | undefined = useMemo(() => {
    if (activeJobId) {
      return jobs.find((j) => j.id === activeJobId);
    }
    return jobs[0];
  }, [activeJobId, jobs]);

  const currentStatus: VideoTranslateJobStatus | undefined = activeJobStatus.data;
  const isLiveProcessing = !!currentStatus && currentStatus.isProcessing;

  return (
    <PageContainer>
      <PageHeader
        title="Pipeline dịch video"
        description="Upload → STT → dịch → TTS → blur + sub + logo + crop 16:9 — tự động end-to-end"
        icon={<Wand2 size={18} />}
        actions={
          <Badge variant="violet" size="sm">
            {jobs.length} job{jobs.length === 1 ? '' : 's'}
          </Badge>
        }
      />
      <PageContent className="!p-0 !overflow-hidden">
        <div className="flex h-full min-h-0">
          {/* ============ LEFT: Config panel ============ */}
          <aside className="w-[340px] shrink-0 border-r border-[#2b2d31] bg-[#131416] flex flex-col overflow-y-auto">
            <div className="p-4 space-y-4">
              <SectionTitle icon={<Upload size={14} />} title="1. Video gốc" />
              <UploadDropzone
                accept="video/*"
                fileName={videoFileName}
                fileSize={videoSize}
                isUploading={uploadVideoMut.isPending}
                onFile={handleVideoUpload}
                onClear={() => { setVideoUrl(''); setVideoPath(''); setVideoFileName(''); setVideoSize(0); setTiktokInfo(null); }}
                icon={<FileVideo size={40} />}
                label="Kéo thả video vào đây"
                hint="MP4 / MOV / MKV / WEBM — tối đa 2GB"
              />

              {/* TikTok URL import — downloads a video by URL and loads it
                  directly into the pipeline without manual upload. */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">
                  <span className="text-zinc-600">─</span> hoặc tải từ TikTok <span className="text-zinc-600">─</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <LinkIcon size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={tiktokUrl}
                      onChange={(e) => setTiktokUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleTiktokDownload(); }}
                      placeholder="https://vt.tiktok.com/..."
                      className="text-xs pl-7 h-8"
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTiktokDownload}
                    disabled={!tiktokUrl.trim() || tiktokDownloadMut.isPending}
                    className="h-8 px-2.5"
                  >
                    {tiktokDownloadMut.isPending ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Download size={11} />
                    )}
                    Tải
                  </Button>
                </div>
                {tiktokInfo && (
                  <div className="flex items-center gap-2 p-1.5 rounded bg-[#1a1b1e] border border-[#2b2d31]">
                    {tiktokInfo.cover && (
                      <img src={tiktokInfo.cover} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-zinc-200 truncate">{tiktokInfo.title}</div>
                      <div className="text-[9px] text-zinc-500">@{tiktokInfo.author}</div>
                    </div>
                  </div>
                )}
              </div>

              {videoUrl && (
                <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <Check size={12} /> Sẵn sàng xử lý
                </div>
              )}

              <SectionTitle icon={<ImageIcon size={14} />} title="2. Logo Sleiz Vietsub" />
              <label className="flex items-center gap-2.5 cursor-pointer p-2 rounded-md hover:bg-[#1a1b1e] transition-colors mb-2">
                <input
                  type="checkbox"
                  checked={logoEnabled}
                  onChange={(e) => setLogoEnabled(e.target.checked)}
                  className="w-4 h-4 accent-violet-500 rounded"
                />
                <div className="flex-1">
                  <div className="text-xs text-zinc-200 flex items-center gap-1.5">
                    <ImageIcon size={12} /> Thêm logo vào video
                  </div>
                  <div className="text-[10px] text-zinc-500">Cột trên cùng, góc phải màn hình</div>
                </div>
              </label>
              {logoEnabled && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2.5 rounded-md border border-[#2b2d31] bg-[#1a1b1e]">
                  <div className="w-12 h-12 rounded bg-[#0e0f11] flex items-center justify-center overflow-hidden shrink-0">
                    <img src={logoUrl} alt="logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-200 truncate">{logoFileName}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">Vị trí: Cột trên — góc phải</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => document.getElementById('logo-upload-input')?.click()}
                  >
                    <Upload size={12} /> Đổi logo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUseDefaultLogo}
                    title="Dùng logo Sleiz Vietsub mặc định"
                  >
                    Mặc định
                  </Button>
                  <input
                    id="logo-upload-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleLogoUpload(f);
                      e.currentTarget.value = '';
                    }}
                  />
                </div>
              </div>
              )}

              <SectionTitle icon={<Volume2 size={14} />} title="3. Âm thanh" />
              <Field label="Giọng đọc TTS" hint="TikTok Vietnamese voices">
                <Select value={voice} onChange={(e) => setVoice(e.target.value)} className="h-9 text-xs">
                  {VOICES.map((v) => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label={`Tốc độ đọc: ${ttsSpeed.toFixed(2)}×`}
                hint="0.5× chậm — 1.0× bình thường — 2.0× nhanh"
              >
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(Number(e.target.value))}
                  className="w-full h-1.5 accent-violet-500 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-1">
                  <span>0.5×</span>
                  <span>1.0×</span>
                  <span>2.0×</span>
                </div>
              </Field>

              <Field
                label={`Âm lượng TTS: ${Math.round(ttsVolume * 100)}%`}
                hint="To nhỏ giọng đọc Việt"
              >
                <input
                  type="range"
                  min={0}
                  max={3.0}
                  step={0.05}
                  value={ttsVolume}
                  onChange={(e) => setTtsVolume(Number(e.target.value))}
                  className="w-full h-1.5 accent-violet-500 cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-1">
                  <span>tắt</span>
                  <span>100%</span>
                  <span>300%</span>
                </div>
              </Field>

              <Field label="Âm thanh gốc">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOriginalAudioMode('replace')}
                    className={`flex-1 px-2 py-1.5 rounded text-[11px] transition-colors border ${
                      originalAudioMode === 'replace'
                        ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                        : 'bg-[#1a1b1e] text-zinc-400 border-[#2b2d31] hover:text-zinc-200'
                    }`}
                  >
                    Thay thế (tắt gốc)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOriginalAudioMode('mix')}
                    className={`flex-1 px-2 py-1.5 rounded text-[11px] transition-colors border ${
                      originalAudioMode === 'mix'
                        ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                        : 'bg-[#1a1b1e] text-zinc-400 border-[#2b2d31] hover:text-zinc-200'
                    }`}
                  >
                    Trộn (giữ gốc)
                  </button>
                </div>
              </Field>

              {originalAudioMode === 'mix' && (
                <Field
                  label={`Âm lượng gốc: ${Math.round(originalAudioVolume * 100)}%`}
                  hint="Nhạc nền / tiếng môi trường của video gốc"
                >
                  <input
                    type="range"
                    min={0}
                    max={1.0}
                    step={0.05}
                    value={originalAudioVolume}
                    onChange={(e) => setOriginalAudioVolume(Number(e.target.value))}
                    className="w-full h-1.5 accent-violet-500 cursor-pointer"
                  />
                </Field>
              )}

              <SectionTitle icon={<Settings size={14} />} title="4. Tuỳ chọn xử lý" />

              {logoEnabled && (
                <Field label={`Cỡ logo: ${Math.round(logoScale * 100)}% chiều ngang video`}>
                  <input
                    type="range"
                    min={0.05}
                    max={0.3}
                    step={0.01}
                    value={logoScale}
                    onChange={(e) => setLogoScale(Number(e.target.value))}
                    className="w-full h-1.5 accent-violet-500 cursor-pointer"
                  />
                </Field>
              )}

              <Field label={`Độ mạnh blur: ${blurIntensity}px`}>
                <input
                  type="range"
                  min={5}
                  max={40}
                  step={1}
                  value={blurIntensity}
                  onChange={(e) => setBlurIntensity(Number(e.target.value))}
                  className="w-full h-1.5 accent-violet-500 cursor-pointer"
                />
              </Field>

              <label className="flex items-center gap-2.5 cursor-pointer p-2 rounded-md hover:bg-[#1a1b1e] transition-colors">
                <input
                  type="checkbox"
                  checked={cropTo16x9}
                  onChange={(e) => setCropTo16x9(e.target.checked)}
                  className="w-4 h-4 accent-violet-500 rounded"
                />
                <div className="flex-1">
                  <div className="text-xs text-zinc-200 flex items-center gap-1.5">
                    <Crop size={12} /> Crop 16:9 (YouTube)
                  </div>
                  <div className="text-[10px] text-zinc-500">Tự động crop bỏ nền đen, định dạng YouTube</div>
                </div>
              </label>

              {/* Hint: actual export button is in the video preview panel,
                  next to the play controls — CapCut-style. */}
              <div className="pt-3 border-t border-[#2b2d31]">
                <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
                  {videoPath
                    ? 'Bấm nút “Xuất video” ở bảng xem trước để chạy pipeline'
                    : 'Cần tải video lên trước'}
                </p>
              </div>
            </div>
          </aside>

          {/* ============ CENTER: Video preview ============ */}
          <main className="flex-1 min-w-0 flex flex-col bg-[#0e0f11]">
            <VideoPreviewPanel
              originalUrl={videoUrl}
              outputUrl={currentStatus?.outputVideoUrl || activeJobForPanel?.outputVideoUrl || ''}
              thumbnailUrl={currentStatus?.thumbnailUrl || activeJobForPanel?.thumbnailUrl || ''}
              activeTab={previewTab}
              onTabChange={setPreviewTab}
              isProcessing={isLiveProcessing}
              hasOutput={!!(currentStatus?.outputVideoUrl || activeJobForPanel?.outputVideoUrl)}
              // Preview overlay props (CapCut-style live preview)
              previewMode={previewMode}
              onTogglePreviewMode={() => setPreviewMode((v) => !v)}
              videoMeta={videoMeta.data || null}
              cropTo16x9={cropTo16x9}
              logoEnabled={logoEnabled}
              logoUrl={logoUrl}
              logoScale={logoScale}
              blurIntensity={blurIntensity}
              // Export handler — kicks off the full pipeline
              onExport={handleStartPipeline}
              canExport={canStartPipeline && !isLiveProcessing}
              isExporting={isLiveProcessing}
            />
          </main>

          {/* ============ RIGHT: Progress + History ============ */}
          <aside className="w-[360px] shrink-0 border-l border-[#2b2d31] bg-[#131416] flex flex-col overflow-hidden">
            <div className="p-3 border-b border-[#2b2d31] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Eye size={12} /> Tiến độ hiện tại
              </h3>
              {isLiveProcessing && (
                <Button variant="ghost" size="sm" onClick={handleCancelJob} className="text-red-400">
                  <X size={12} /> Huỷ
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              <PipelineProgress
                status={currentStatus}
                job={activeJobForPanel}
                isLive={isLiveProcessing}
              />
            </div>
            <div className="border-t border-[#2b2d31] flex flex-col min-h-0 max-h-[40%]">
              <div className="p-3 border-b border-[#2b2d31]/60 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Lịch sử ({jobs.length})
                </h3>
                <Button variant="ghost" size="sm" onClick={() => jobsQuery.refetch()}>
                  <RefreshCw size={11} />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <JobsHistory
                  jobs={jobs}
                  activeJobId={activeJobId}
                  onSelect={handleLoadJob}
                  onRetry={handleRetryJob}
                  onDelete={handleDeleteJob}
                />
              </div>
            </div>
          </aside>
        </div>
      </PageContent>
    </PageContainer>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-zinc-300">
      <span className="text-violet-400">{icon}</span>
      <h2 className="text-xs font-semibold uppercase tracking-wider">{title}</h2>
    </div>
  );
}

function UploadDropzone({
  accept,
  fileName,
  fileSize,
  isUploading,
  onFile,
  onClear,
  icon,
  label,
  hint,
}: {
  accept: string;
  fileName: string;
  fileSize: number;
  isUploading: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => !fileName && inputRef.current?.click()}
      className={`relative rounded-lg border-2 border-dashed transition-all cursor-pointer
        ${isDragging ? 'border-violet-500 bg-violet-500/10' : 'border-[#2b2d31] hover:border-violet-500/50'}
        ${fileName ? 'p-3' : 'p-6'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = '';
        }}
      />
      {isUploading ? (
        <div className="flex flex-col items-center gap-2 py-3">
          <Loader2 size={28} className="text-violet-400 animate-spin" />
          <span className="text-xs text-zinc-400">Đang tải lên...</span>
        </div>
      ) : fileName ? (
        <div className="flex items-center gap-3">
          <div className="text-violet-400 shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-100 truncate font-medium">{fileName}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {fileSize > 0 ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : ''}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded text-zinc-500"
            title="Xoá"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="text-zinc-500">{icon}</div>
          <div className="text-xs text-zinc-300 font-medium">{label}</div>
          <div className="text-[10px] text-zinc-500">{hint}</div>
        </div>
      )}
    </div>
  );
}

function VideoPreviewPanel({
  originalUrl,
  outputUrl,
  thumbnailUrl,
  activeTab,
  onTabChange,
  isProcessing,
  hasOutput,
  // Preview overlay props
  previewMode,
  onTogglePreviewMode,
  videoMeta,
  cropTo16x9,
  logoEnabled,
  logoUrl,
  logoScale,
  blurIntensity,
  // Export handler
  onExport,
  canExport,
  isExporting,
}: {
  originalUrl: string;
  outputUrl: string;
  thumbnailUrl: string;
  activeTab: 'original' | 'output';
  onTabChange: (t: 'original' | 'output') => void;
  isProcessing: boolean;
  hasOutput: boolean;
  previewMode: boolean;
  onTogglePreviewMode: () => void;
  videoMeta: VideoMetadataInfo | null;
  cropTo16x9: boolean;
  logoEnabled: boolean;
  logoUrl: string;
  logoScale: number;
  blurIntensity: number;
  onExport: () => void;
  canExport: boolean;
  isExporting: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Track the actual rendered video element rect (the letterboxed area,
  // not the full container) so overlays line up with the visible frame.
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoRect, setVideoRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const currentUrl = activeTab === 'original' ? originalUrl : outputUrl;
  // Only show preview overlays on the "Gốc" tab — the "Bản dịch" tab
  // already shows the real rendered output, so overlays would be redundant.
  const showOverlays = previewMode && activeTab === 'original' && !!currentUrl;

  // Reset player when source changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    setCurrentTime(0);
    if (currentUrl) {
      v.load();
    }
  }, [currentUrl]);

  // Attach listeners
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentUrl) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVol = () => setVolume(v.volume);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
    };
  }, [currentUrl]);

  // Track the actual rendered video rect (letterboxed inside the container)
  // so preview overlays can be positioned pixel-accurately over the frame.
  useEffect(() => {
    if (!showOverlays) return;
    const updateRect = () => {
      const v = videoRef.current;
      const c = containerRef.current;
      if (!v || !c) return;
      const vRect = v.getBoundingClientRect();
      const cRect = c.getBoundingClientRect();
      setVideoRect({
        left: vRect.left - cRect.left,
        top: vRect.top - cRect.top,
        width: vRect.width,
        height: vRect.height,
      });
    };
    updateRect();
    // Re-measure on resize, on metadata load, and periodically while
    // container size may still be settling.
    const ro = new ResizeObserver(updateRect);
    if (containerRef.current) ro.observe(containerRef.current);
    if (videoRef.current) {
      videoRef.current.addEventListener('loadedmetadata', updateRect);
    }
    window.addEventListener('resize', updateRect);
    const interval = setInterval(updateRect, 500);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateRect);
      if (videoRef.current) videoRef.current.removeEventListener('loadedmetadata', updateRect);
      clearInterval(interval);
    };
  }, [showOverlays, currentUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  };
  const seek = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + delta));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab switcher + preview toggle + export button */}
      <div className="flex items-center gap-1 p-2 border-b border-[#2b2d31] bg-[#131416]">
        <TabButton
          active={activeTab === 'original'}
          onClick={() => onTabChange('original')}
          icon={<Film size={12} />}
          label="Gốc"
          disabled={!originalUrl}
        />
        <TabButton
          active={activeTab === 'output'}
          onClick={() => onTabChange('output')}
          icon={<Check size={12} />}
          label="Bản dịch"
          disabled={!hasOutput}
          badge={hasOutput ? 'Sẵn sàng' : undefined}
        />
        <div className="flex-1" />

        {/* Preview mode toggle (CapCut-style) — only relevant on Gốc tab */}
        {activeTab === 'original' && originalUrl && (
          <button
            onClick={onTogglePreviewMode}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors border ${
              previewMode
                ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
                : 'bg-[#1a1b1e] text-zinc-400 border-[#2b2d31] hover:text-zinc-200'
            }`}
            title="Bật/tắt xem trước crop, logo, blur"
          >
            <Eye size={11} /> Xem trước
          </button>
        )}

        {hasOutput && activeTab === 'output' && outputUrl && (
          <a
            href={outputUrl}
            download
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] text-violet-300 hover:bg-violet-500/10 transition-colors"
          >
            <Download size={11} /> Tải về
          </a>
        )}

        {/* Export button — kicks off the full pipeline. CapCut-style: lives
            next to the preview so the user iterates on preview first, then
            commits to a render. */}
        <Button
          variant="primary"
          size="sm"
          onClick={onExport}
          disabled={!canExport}
          className="ml-1"
          title={canExport ? 'Chạy pipeline đầy đủ: STT → dịch → TTS → render' : 'Cần tải video lên trước'}
        >
          {isExporting ? (
            <><Loader2 size={12} className="animate-spin" /> Đang xuất...</>
          ) : (
            <><Wand2 size={12} /> Xuất video</>
          )}
        </Button>
      </div>

      {/* Video viewport */}
      <div ref={containerRef} className="flex-1 bg-black flex items-center justify-center relative min-h-0 overflow-hidden">
        {currentUrl ? (
          <>
            <video
              ref={videoRef}
              src={currentUrl}
              className="w-full h-full object-contain"
              playsInline
              preload="metadata"
              crossOrigin="anonymous"
            />
            {/* CapCut-style preview overlays — crop guide, logo, blur region */}
            {showOverlays && videoRect && (
              <PreviewOverlay
                videoRect={videoRect}
                videoMeta={videoMeta}
                cropTo16x9={cropTo16x9}
                logoEnabled={logoEnabled}
                logoUrl={logoUrl}
                logoScale={logoScale}
                blurIntensity={blurIntensity}
              />
            )}
            {/* Custom controls */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 py-2 z-20">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = Number(e.target.value);
                  setCurrentTime(Number(e.target.value));
                }}
                className="w-full h-1 accent-violet-500 cursor-pointer mb-2"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 ${duration ? (currentTime / duration) * 100 : 0}%, #3a3c41 ${duration ? (currentTime / duration) * 100 : 0}%)`,
                  borderRadius: '2px',
                }}
              />
              <div className="flex items-center gap-2 text-white">
                <button onClick={() => seek(-10)} className="p-1 hover:bg-white/10 rounded" title="Lùi 10 giây">
                  <SkipBack size={14} />
                </button>
                <button onClick={togglePlay} className="p-1.5 hover:bg-white/10 rounded" title={isPlaying ? 'Tạm dừng' : 'Phát'}>
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button onClick={() => seek(10)} className="p-1 hover:bg-white/10 rounded" title="Tiến 10 giây">
                  <SkipForward size={14} />
                </button>
                <span className="text-xs font-mono tabular-nums text-zinc-200 ml-1">
                  {formatTimestamp(currentTime * 1000)} / {formatTimestamp(duration * 1000)}
                </span>
                <div className="flex-1" />
                {videoMeta && (
                  <span className="text-[10px] text-zinc-500 font-mono tabular-nums mr-2">
                    {videoMeta.width}×{videoMeta.height} · {videoMeta.fps.toFixed(1)}fps
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <Volume2 size={14} className="text-zinc-300" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => {
                      const v = videoRef.current;
                      if (v) v.volume = Number(e.target.value);
                      setVolume(Number(e.target.value));
                    }}
                    className="w-16 h-1 accent-violet-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-zinc-500 px-6">
            {isProcessing ? (
              <>
                <Loader2 size={48} className="mx-auto mb-3 text-violet-400 animate-spin" />
                <p className="text-base">Đang xử lý video...</p>
                <p className="text-xs mt-2 text-zinc-600">Theo dõi tiến độ ở bảng bên phải</p>
              </>
            ) : (
              <>
                <FileVideo size={56} className="mx-auto mb-3 opacity-50" />
                <p className="text-base">Chưa có video</p>
                <p className="text-xs mt-2 text-zinc-600">Tải video lên ở bảng bên trái để bắt đầu</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CapCut-style preview overlay.
 *
 * Renders on top of the HTML5 video element to show what the exported
 * video will look like, without running the actual FFmpeg pipeline:
 *
 *   - Crop guide: if cropTo16x9 is on and the source video is not 16:9,
 *     draws dashed lines showing the region that will be kept (and
 *     darkens the rest).
 *   - Logo: shows the actual logo image at the top-right corner, scaled
 *     to logoScale × video width. Position is hardcoded to top-right
 *     per user spec.
 *   - Blur region: shows the bottom-20% subtitle area that will be
 *     blurred to hide the original Chinese text. Uses backdrop-blur to
 *     approximate the FFmpeg boxblur effect.
 *
 * All overlays are positioned relative to the actual letterboxed video
 * rect (videoRect), not the full container, so they stay aligned even
 * when the video has different aspect ratio than the container.
 */
function PreviewOverlay({
  videoRect,
  videoMeta,
  cropTo16x9,
  logoEnabled,
  logoUrl,
  logoScale,
  blurIntensity,
}: {
  videoRect: { left: number; top: number; width: number; height: number };
  videoMeta: VideoMetadataInfo | null;
  cropTo16x9: boolean;
  logoEnabled: boolean;
  logoUrl: string;
  logoScale: number;
  blurIntensity: number;
}) {
  // Compute crop region (in % of video frame) so the overlay stays
  // accurate regardless of the rendered video size.
  let cropRegion: { xPct: number; yPct: number; wPct: number; hPct: number } | null = null;
  if (cropTo16x9 && videoMeta && !videoMeta.isAlready16x9) {
    const sourceRatio = videoMeta.width / videoMeta.height;
    const targetRatio = 16 / 9;
    if (sourceRatio > targetRatio) {
      // Too wide — crop width (center crop)
      const newWPct = (1 / sourceRatio) * targetRatio; // = targetRatio / sourceRatio
      const xPct = (1 - newWPct) / 2;
      cropRegion = { xPct, yPct: 0, wPct: newWPct, hPct: 1 };
    } else {
      // Too tall — crop height (center crop)
      const newHPct = sourceRatio / targetRatio;
      const yPct = (1 - newHPct) / 2;
      cropRegion = { xPct: 0, yPct, wPct: 1, hPct: newHPct };
    }
  }

  const { left, top, width, height } = videoRect;

  // Compute pixel positions for the crop region (the part that will be KEPT)
  const cropLeft = cropRegion ? left + cropRegion.xPct * width : 0;
  const cropTop = cropRegion ? top + cropRegion.yPct * height : 0;
  const cropW = cropRegion ? cropRegion.wPct * width : 0;
  const cropH = cropRegion ? cropRegion.hPct * height : 0;

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {/* Crop guide — 4 dark rectangles around the kept region to dim the
          areas that will be cropped out. Uses an SVG mask alternative
          would be cleaner, but 4 simple divs is the most cross-browser. */}
      {cropRegion && (
        <>
          {/* Top strip (above crop) */}
          <div
            className="absolute bg-black/65"
            style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${cropTop - top}px` }}
          />
          {/* Bottom strip (below crop) */}
          <div
            className="absolute bg-black/65"
            style={{
              left: `${left}px`,
              top: `${cropTop + cropH}px`,
              width: `${width}px`,
              height: `${(top + height) - (cropTop + cropH)}px`,
            }}
          />
          {/* Left strip (left of crop, between top and bottom strips) */}
          <div
            className="absolute bg-black/65"
            style={{ left: `${left}px`, top: `${cropTop}px`, width: `${cropLeft - left}px`, height: `${cropH}px` }}
          />
          {/* Right strip (right of crop) */}
          <div
            className="absolute bg-black/65"
            style={{
              left: `${cropLeft + cropW}px`,
              top: `${cropTop}px`,
              width: `${(left + width) - (cropLeft + cropW)}px`,
              height: `${cropH}px`,
            }}
          />
          {/* Crop border (dashed violet) */}
          <div
            className="absolute border-2 border-dashed border-violet-400"
            style={{ left: `${cropLeft}px`, top: `${cropTop}px`, width: `${cropW}px`, height: `${cropH}px` }}
          />
          {/* Crop label */}
          <div
            className="absolute text-[10px] text-violet-100 bg-violet-500/70 px-1.5 py-0.5 rounded backdrop-blur-sm font-medium"
            style={{ left: `${cropLeft + 4}px`, top: `${cropTop + 4}px` }}
          >
            <Crop size={9} className="inline mr-0.5" /> 16:9 (sẽ giữ lại)
          </div>
          {/* Cut-away labels */}
          <div
            className="absolute text-[9px] text-zinc-400 font-medium"
            style={{ left: `${left + 4}px`, top: `${top + 4}px` }}
          >
            ✂ bỏ
          </div>
        </>
      )}

      {/* Logo overlay (top-right, scaled by logoScale × video width) */}
      {logoEnabled && logoUrl && (
        <img
          src={logoUrl}
          alt="logo preview"
          crossOrigin="anonymous"
          className="absolute object-contain"
          style={{
            left: `${left + width - width * logoScale - 12}px`,
            top: `${top + 12}px`,
            width: `${width * logoScale}px`,
            height: 'auto',
            maxHeight: `${height * 0.2}px`,
            // Subtle drop shadow so the logo is visible on light backgrounds
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          }}
        />
      )}

      {/* Blur region preview (bottom 20% — matches detectChineseTextRegions
          default subtitle region) */}
      <div
        className="absolute border border-dashed border-amber-400/70"
        style={{
          left: `${left}px`,
          top: `${top + height * 0.8}px`,
          width: `${width}px`,
          height: `${height * 0.2}px`,
          backdropFilter: `blur(${Math.min(20, blurIntensity / 2)}px)`,
          WebkitBackdropFilter: `blur(${Math.min(20, blurIntensity / 2)}px)`,
          backgroundColor: 'rgba(0,0,0,0.1)',
        }}
      >
        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-amber-100 bg-amber-500/70 px-1.5 py-0.5 rounded backdrop-blur-sm whitespace-nowrap font-medium">
          Blur {blurIntensity}px (che chữ Trung)
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
        ${active
          ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
          : disabled
            ? 'text-zinc-600 cursor-not-allowed'
            : 'text-zinc-400 hover:bg-[#2b2d31] hover:text-zinc-200 border border-transparent'
        }`}
    >
      {icon}
      {label}
      {badge && (
        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 uppercase">
          {badge}
        </span>
      )}
    </button>
  );
}

function PipelineProgress({
  status,
  job,
  isLive,
}: {
  status: VideoTranslateJobStatus | undefined;
  job: VideoTranslateJob | undefined;
  isLive: boolean;
}) {
  if (!status && !job) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<Wand2 size={32} />}
          title="Chưa có job nào"
          description="Khởi động pipeline để xem tiến độ"
        />
      </div>
    );
  }

  const currentStep = status?.currentStep || job?.currentStep || 'queued';
  const progress = status?.progress ?? job?.progress ?? 0;
  const jobStatus = status?.status || job?.status || 'queued';
  const error = status?.error || job?.error;

  // Find current step index
  const activeStepIndex = PIPELINE_STEPS.findIndex((s) => s.key === currentStep);
  const displayIndex = activeStepIndex >= 0 ? activeStepIndex : 0;

  return (
    <div className="p-3 space-y-3">
      {/* Status badge + progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <StatusDot status={jobStatus} />
            <span className="text-xs text-zinc-200 font-medium capitalize">{jobStatus}</span>
          </div>
          <span className="text-xs text-zinc-400 tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 bg-[#2b2d31] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${jobStatus === 'failed' ? 'bg-red-500' : jobStatus === 'completed' ? 'bg-emerald-500' : 'bg-violet-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {job && (
          <div className="text-[10px] text-zinc-500 mt-1.5 flex items-center gap-1">
            <Clock size={10} />
            {new Date(job.createdAt * 1000).toLocaleString('vi-VN')}
          </div>
        )}
      </div>

      {error && (
        <div className="p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-1.5">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <div className="break-words">{error}</div>
        </div>
      )}

      {/* Step list */}
      <div className="space-y-1">
        {PIPELINE_STEPS.map((step, idx) => {
          const isDone = idx < displayIndex || jobStatus === 'completed';
          const isActive = idx === displayIndex && jobStatus !== 'completed' && jobStatus !== 'failed';
          const isFailed = jobStatus === 'failed' && isActive;
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-start gap-2.5 p-2 rounded-md text-xs transition-colors
                ${isActive ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent'}
                ${isFailed ? 'bg-red-500/10 border border-red-500/30' : ''}`}
            >
              <div className={`mt-0.5 shrink-0 ${isDone ? 'text-emerald-400' : isActive ? (isFailed ? 'text-red-400' : 'text-violet-400') : 'text-zinc-600'}`}>
                {isDone ? <Check size={14} /> : isActive && isLive ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${isDone ? 'text-zinc-300' : isActive ? 'text-zinc-100' : 'text-zinc-500'}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5">{step.hint}</div>
              </div>
              {idx < PIPELINE_STEPS.length - 1 && (
                <ArrowRight size={10} className="text-zinc-700 mt-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Output preview / download */}
      {(status?.outputVideoUrl || job?.outputVideoUrl) && (
        <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300 font-medium">
            <Check size={12} /> Video đã xử lý xong
          </div>
          {(status?.thumbnailUrl || job?.thumbnailUrl) && (
            <img
              src={status?.thumbnailUrl || job?.thumbnailUrl || ''}
              alt="thumbnail"
              className="w-full rounded"
            />
          )}
          <a
            href={status?.outputVideoUrl || job?.outputVideoUrl || ''}
            download
            className="block w-full text-center px-3 py-1.5 rounded text-xs bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 transition-colors"
          >
            <Download size={12} className="inline mr-1" /> Tải video về
          </a>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed' ? 'bg-emerald-400' :
    status === 'failed' ? 'bg-red-400' :
    status === 'processing' || status === 'queued' ? 'bg-violet-400 animate-pulse' :
    'bg-zinc-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function JobsHistory({
  jobs,
  activeJobId,
  onSelect,
  onRetry,
  onDelete,
}: {
  jobs: VideoTranslateJob[];
  activeJobId: string | null;
  onSelect: (job: VideoTranslateJob) => void;
  onRetry: (jobId: string) => void;
  onDelete: (jobId: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<Clock size={28} />}
          title="Chưa có job nào"
          description="Pipeline sẽ xuất hiện ở đây"
        />
      </div>
    );
  }
  return (
    <div className="divide-y divide-[#2b2d31]">
      {jobs.map((job) => {
        const isActive = job.id === activeJobId;
        return (
          <div
            key={job.id}
            onClick={() => onSelect(job)}
            className={`p-3 cursor-pointer transition-colors ${isActive ? 'bg-violet-500/10 border-l-2 border-l-violet-500' : 'hover:bg-[#1a1b1e] border-l-2 border-l-transparent'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusDot status={job.status} />
              <span className="text-xs text-zinc-200 truncate flex-1 font-medium">
                {job.settings?.voice || 'BV074'}
              </span>
              <span className="text-[10px] text-zinc-500 tabular-nums">
                {new Date(job.createdAt * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
              </span>
            </div>
            <div className="text-[10px] text-zinc-500 truncate mb-1.5">
              {job.originalVideoPath.split('/').pop() || 'video'}
            </div>
            <div className="flex items-center gap-1.5">
              {job.status === 'completed' && job.outputVideoUrl && (
                <a
                  href={job.outputVideoUrl}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                  title="Tải về"
                >
                  <Download size={11} />
                </a>
              )}
              {job.status === 'failed' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRetry(job.id); }}
                  className="p-1 rounded hover:bg-violet-500/20 text-violet-400"
                  title="Chạy lại"
                >
                  <RefreshCw size={11} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                className="p-1 rounded hover:bg-red-500/20 text-red-400 ml-auto"
                title="Xoá"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
