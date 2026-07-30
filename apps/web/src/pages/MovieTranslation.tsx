import { useMemo, useRef, useState } from 'react';
import { Download, FileJson, Film, Loader2, Mic2, Sparkles, Upload, Video } from 'lucide-react';
import { Button, Input, Select, useToast } from '@sleiz/ui';
import { PageContainer, PageContent, PageHeader } from '../components/Page';
import {
  type RenderVideoResult,
  useCancelJob,
  useEpisodes,
  useImportSubtitle,
  useJob,
  useStartTranslateSubtitle,
  useStartVideoRender,
  useSubtitles,
  useTranslateSubtitleStatus,
  useUploadMovieVideo,
} from '../api/hooks';

const TTS_MODEL = 'canopylabs/orpheus-v1-english';
// Voices supported by Revid API's edge engine (verified 2026-07-28).
// ThuyDuong/QuocDung are valid Edge voices locally but Revid returns
// "No audio was received" for them, so they are intentionally excluded.
const VIETNAMESE_VOICES = [
  { value: 'vi-VN-HoaiMyNeural', label: 'Nữ (Hoài My - Việt Nam)' },
  { value: 'vi-VN-NamMinhNeural', label: 'Nam (Nam Minh - Việt Nam)' },
];
const GROQ_VOICES = [
  { value: 'autumn', label: 'Autumn (Nữ)' },
  { value: 'diana', label: 'Diana (Nữ)' },
  { value: 'hannah', label: 'Hannah (Nữ)' },
  { value: 'austin', label: 'Austin (Nam)' },
  { value: 'daniel', label: 'Daniel (Nam)' },
  { value: 'troy', label: 'Troy (Nam)' },
];

export function MovieTranslationPage() {
  const { toast } = useToast();
  const episodesQuery = useEpisodes();
  const episodes = episodesQuery.data ?? [];
  const [episodeId, setEpisodeId] = useState('');
  const [subtitleId, setSubtitleId] = useState('');
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [ttsEngine, setTtsEngine] = useState<'revid' | 'edge' | 'groq'>('revid');
  const [audioMode, setAudioMode] = useState<'duck' | 'replace'>('duck');
  const [voice, setVoice] = useState('vi-VN-HoaiMyNeural');
  const [jobId, setJobId] = useState<string | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const subtitleInput = useRef<HTMLInputElement>(null);
  const selectedEpisode = episodes.find((item) => item.id === episodeId);
  const subtitlesQuery = useSubtitles(episodeId || undefined);
  const subtitles = subtitlesQuery.data ?? [];
  const activeSubtitle = subtitles.find((item) => item.id === subtitleId);
  const translation = useTranslateSubtitleStatus(subtitleId || null, !!subtitleId);
  const uploadVideo = useUploadMovieVideo();
  const importSubtitle = useImportSubtitle();
  const translate = useStartTranslateSubtitle();
  const render = useStartVideoRender();
  const job = useJob(jobId);
  const cancel = useCancelJob();
  const renderResult = useMemo(() => {
    try { return job.data?.result ? JSON.parse(job.data.result) as RenderVideoResult : null; } catch { return null; }
  }, [job.data?.result]);

  const selectEpisode = (id: string) => {
    setEpisodeId(id);
    setSubtitleId('');
    setSubtitleFile(null);
  };

  const handleVideoUpload = () => {
    if (!episodeId || !videoFile) {
      toast({ title: 'Thiếu video', description: 'Chọn tập phim và file video trước.', variant: 'error' });
      return;
    }
    uploadVideo.mutate({ episodeId, file: videoFile }, {
      onSuccess: (result) => toast({ title: 'Đã tải video lên', description: result.data.fileName, variant: 'success' }),
      onError: (error) => toast({ title: 'Không thể tải video', description: error.message, variant: 'error' }),
    });
  };

  const handleImport = async () => {
    if (!episodeId || !subtitleFile) {
      toast({ title: 'Thiếu phụ đề', description: 'Chọn tập phim và file JSON/SRT trước.', variant: 'error' });
      return;
    }
    try {
      const content = await subtitleFile.text();
      importSubtitle.mutate({ episodeId, content, filename: subtitleFile.name, language: 'zh' }, {
        onSuccess: (result) => {
          setSubtitleId(result.data.id);
          toast({ title: 'Đã chuẩn hóa phụ đề', description: `${result.data.cueCount} câu; có thể bắt đầu dịch và xuất SRT.`, variant: 'success' });
        },
        onError: (error) => toast({ title: 'Không thể nạp phụ đề', description: error.message, variant: 'error' }),
      });
    } catch (error) {
      toast({ title: 'Không thể đọc file', description: error instanceof Error ? error.message : '', variant: 'error' });
    }
  };

  const handleTranslate = () => {
    if (!subtitleId) return;
    translate.mutate({ subtitleId, provider: 'gemini', batchSize: 100 }, {
      onSuccess: () => toast({ title: 'Đã bắt đầu dịch', description: 'Theo dõi tiến độ ở bước 3. Chỉ kết xuất sau khi tất cả câu đã dịch.', variant: 'success' }),
      onError: (error) => toast({ title: 'Không thể bắt đầu dịch', description: error.message, variant: 'error' }),
    });
  };

  const handleRender = () => {
    if (!episodeId || !subtitleId || !selectedEpisode?.videoPath) {
      toast({ title: 'Chưa sẵn sàng', description: 'Cần có video đã tải lên và phụ đề đã dịch.', variant: 'error' });
      return;
    }
    if (!translation.data?.done || translation.data.failedBatches > 0) {
      toast({ title: 'Phụ đề chưa hoàn tất', description: 'Hoàn tất toàn bộ bản dịch và xử lý các batch lỗi trước khi kết xuất.', variant: 'error' });
      return;
    }
    render.mutate({ episodeId, subtitleId, audioMode, ttsEngine, model: TTS_MODEL, voice }, {
      onSuccess: (result) => {
        setJobId(result.data.id);
        toast({ title: 'Đang tạo video', description: 'TTS, ghép tiếng, chèn phụ đề và mã hóa chạy nền.', variant: 'success' });
      },
      onError: (error) => toast({ title: 'Không thể tạo video', description: error.message, variant: 'error' }),
    });
  };

  const translatedCount = activeSubtitle?.cues.filter((cue) => cue.textTranslated?.trim()).length ?? 0;
  const currentVoiceOptions = ttsEngine === 'groq' ? GROQ_VOICES : VIETNAMESE_VOICES;

  return (
    <PageContainer>
      <PageHeader title="Dịch Phim" description="Video + JSON/SRT → Vietsub → giọng AI → video MP4 hoàn chỉnh" icon={<Film size={18} />} />
      <PageContent className="space-y-5 overflow-y-auto">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-200">
          ✨ <b>Revid API Text-To-Speech (Khuyên dùng):</b> Chuyển đổi phụ đề Việt thành giọng đọc AI tự nhiên chất lượng studio qua revidapi.com, không bị đọc thiếu hay robot như Google TTS.
        </div>
        <section className="grid gap-4 lg:grid-cols-2">
          <Step number="1" title="Chọn tập và video gốc" description="Video được lưu cục bộ để FFmpeg có thể ghép tiếng và chèn phụ đề.">
            <Select value={episodeId} onChange={(event) => selectEpisode(event.target.value)} className="w-full">
              <option value="">— Chọn tập đã tạo —</option>
              {episodes.map((episode) => <option key={episode.id} value={episode.id}>#{episode.episodeNumber} {episode.title}</option>)}
            </Select>
            <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-m4v" className="hidden" onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)} />
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => videoInput.current?.click()}><Video size={14} />{videoFile?.name || 'Chọn video'}</Button>
              <Button variant="primary" size="sm" onClick={handleVideoUpload} disabled={uploadVideo.isPending || !videoFile}>{uploadVideo.isPending ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}Tải lên</Button>
            </div>
            {selectedEpisode?.videoPath && <p className="mt-3 text-xs text-emerald-300">✓ Video đã sẵn sàng: {selectedEpisode.videoPath.split('/').at(-1)}</p>}
          </Step>
          <Step number="2" title="Nạp JSON hoặc SRT" description="JSON CapCut/generic được chuẩn hóa thành cue timeline; SRT tiếng Việt sẽ được tạo khi kết xuất.">
            <input ref={subtitleInput} type="file" accept=".json,.srt,.vtt,.ass,.ssa,.txt,application/json,text/plain" className="hidden" onChange={(event) => setSubtitleFile(event.target.files?.[0] ?? null)} />
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => subtitleInput.current?.click()}><FileJson size={14} />{subtitleFile?.name || 'Chọn JSON / SRT'}</Button>
              <Button variant="primary" size="sm" onClick={handleImport} disabled={importSubtitle.isPending || !subtitleFile}>{importSubtitle.isPending ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}Nạp phụ đề</Button>
            </div>
            <Select value={subtitleId} onChange={(event) => setSubtitleId(event.target.value)} className="mt-3 w-full">
              <option value="">— Hoặc chọn phụ đề đã nạp —</option>
              {subtitles.map((subtitle) => <option key={subtitle.id} value={subtitle.id}>{subtitle.format.toUpperCase()} · {subtitle.cues.length} câu</option>)}
            </Select>
          </Step>
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <Step number="3" title="Dịch toàn bộ sang tiếng Việt" description="Hệ thống dùng luồng Gemini hiện có; mọi câu phải thành công trước khi tạo tiếng.">
            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleTranslate} disabled={!subtitleId || translate.isPending || translation.data?.running}>{translate.isPending || translation.data?.running ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}Dịch sang tiếng Việt</Button>
              {activeSubtitle && <span className="text-xs text-zinc-400">Đã dịch: {translatedCount}/{activeSubtitle.cues.length} câu</span>}
            </div>
            {translation.data && <Progress label={translation.data.running ? 'Đang dịch phụ đề' : translation.data.done ? 'Dịch phụ đề hoàn tất' : 'Chờ dịch'} value={(translation.data.completedBatches / Math.max(1, translation.data.totalBatches)) * 100} detail={`${translation.data.completedBatches}/${translation.data.totalBatches} batch · lỗi: ${translation.data.failedBatches}`} />}
          </Step>
          <Step number="4" title="Tạo tiếng và kết xuất MP4" description="Mỗi cue được tạo voice AI, đặt đúng timeline, hạ tiếng gốc hoặc thay thế, rồi burn Vietsub vào video.">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Select value={ttsEngine} onChange={(event) => {
                  const engine = event.target.value as 'revid' | 'edge' | 'groq';
                  setTtsEngine(engine);
                  if (engine === 'groq') setVoice('autumn');
                  else setVoice('vi-VN-HoaiMyNeural');
                }}>
                  <option value="revid">Revid API (Khuyên dùng)</option>
                  <option value="edge">Edge TTS (Local)</option>
                  <option value="groq">Groq Speech</option>
                </Select>
                <Select value={voice} onChange={(event) => setVoice(event.target.value)}>
                  {currentVoiceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </div>
              <Select value={audioMode} onChange={(event) => setAudioMode(event.target.value as 'duck' | 'replace')}>
                <option value="duck">Hạ tiếng gốc (Nền nhỏ + AI lồng tiếng)</option>
                <option value="replace">Thay thế hoàn toàn tiếng gốc</option>
              </Select>
            </div>
            <Button variant="primary" size="sm" className="mt-3" onClick={handleRender} disabled={render.isPending || !subtitleId || !selectedEpisode?.videoPath}><Mic2 size={14} />Tạo video hoàn chỉnh</Button>
          </Step>
        </section>
        {jobId && <section className="rounded-lg border border-violet-500/30 bg-[#17181c] p-4">
          <div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-zinc-100">Kết xuất video</h3><p className="text-xs text-zinc-500">Mã tác vụ: {jobId}</p></div>{job.data?.status === 'running' || job.data?.status === 'queued' ? <Button variant="secondary" size="sm" onClick={() => cancel.mutate(jobId)}>Hủy</Button> : null}</div>
          <Progress label={job.data?.status === 'completed' ? 'Hoàn tất' : job.data?.status === 'failed' ? 'Kết xuất thất bại' : 'Đang xử lý'} value={job.data?.progress ?? 0} detail={job.data?.error || 'Tạo giọng AI, ghép vào timeline và mã hóa video.'} />
          {renderResult && <div className="mt-4 flex flex-wrap gap-2"><a className="inline-flex items-center gap-1 rounded bg-violet-600 px-3 py-2 text-xs font-medium text-white" href={renderResult.videoUrl} target="_blank" rel="noreferrer"><Download size={13} />Tải video hoàn chỉnh</a><a className="inline-flex items-center gap-1 rounded border border-[#3a3c41] px-3 py-2 text-xs text-zinc-200" href={renderResult.subtitleUrl} target="_blank" rel="noreferrer">Tải SRT tiếng Việt</a><a className="inline-flex items-center gap-1 rounded border border-[#3a3c41] px-3 py-2 text-xs text-zinc-200" href={renderResult.voiceUrl} target="_blank" rel="noreferrer">Tải voice WAV</a></div>}
        </section>}
      </PageContent>
    </PageContainer>
  );
}

function Step({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-[#2b2d31] bg-[#17181c] p-4"><div className="mb-3 flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-bold text-violet-300">{number}</span><div><h2 className="text-sm font-semibold text-zinc-100">{title}</h2><p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p></div></div>{children}</section>;
}

function Progress({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="mt-3"><div className="mb-1 flex justify-between text-xs"><span className="text-zinc-300">{label}</span><span className="text-violet-300">{Math.round(value)}%</span></div><div className="h-1.5 overflow-hidden rounded bg-[#2b2d31]"><div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div><p className="mt-1.5 text-xs text-zinc-500">{detail}</p></div>;
}