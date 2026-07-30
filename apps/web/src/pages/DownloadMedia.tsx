import { useEffect, useMemo, useState } from 'react';
import {
  Search, Download, Loader2, Play, Heart, MessageCircle, Share2,
  Eye, Clock, User, CheckCircle2, Folder, ExternalLink, Headphones,
  Music, Tv, CloudDownload, Languages, ListChecks, AlertTriangle, Layers,
} from 'lucide-react';
import {
  useBilibiliParse, useBilibiliDownloadVideo,
  useTiktokParse, useTiktokDownload, useHistory, useDownloadStatus,
  type TiktokVideoInfo, useAITranslate,
  useSettings,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input, Badge, EmptyState,
  useToast,
} from '@sleiz/ui';
import { formatDuration, timeAgo, type BilibiliVideoInfo } from '@sleiz/shared';
import { detectDownloadSource, sourceLabel, extractUrls } from '../lib/detectDownloadSource';
import { notifyNative } from '../api/client';

type ParsedPayload =
  | { source: 'bilibili'; data: BilibiliVideoInfo }
  | { source: 'tiktok'; data: TiktokVideoInfo };

interface DownloadItem {
  jobId: string;          // server-side progress key
  filename: string;
  filePath: string;
  fileSize: number;
  durationMs: number;
  source: string;
  kind: 'video' | 'music';
  status?: 'pending' | 'downloading' | 'success' | 'error';
  error?: string;
}

// Một item trong danh sách "tải nhiều link cùng lúc"
interface BatchItem {
  id: string;             // unique key (url + index)
  url: string;
  source: 'bilibili' | 'tiktok' | 'unknown';
  status: 'queued' | 'parsing' | 'parsed' | 'downloading' | 'success' | 'error';
  // Metadata sau khi parse thành công
  title?: string;
  cover?: string;
  author?: string;
  duration?: number;       // giây
  episodeCount?: number;   // Bilibili playlist
  // Sau khi tải xong
  jobId?: string;
  filePath?: string;
  fileSize?: number;
  error?: string;
  translatedTitle?: string;
}

export function DownloadMediaPage() {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [parsed, setParsed] = useState<ParsedPayload | null>(null);
  const [parsing, setParsing] = useState(false);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  // Track which jobIds we still want polled; clearing this stops the
  // useDownloadStatus hooks from firing for completed/errored jobs.
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);

  // ── Multi-link batch download state ───────────────────────────────────────
  // User paste nhiều URL (1 dòng / 1 link), parse song song, hiển thị grid
  // kết quả + nút "Tải tất cả" để tải song song với concurrency limit.
  const [batchInput, setBatchInput] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchParsing, setBatchParsing] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchTranslating, setBatchTranslating] = useState(false);
  const batchTranslateMut = useAITranslate();

  const detected = useMemo(() => detectDownloadSource(url), [url]);

  const biliParse = useBilibiliParse();
  const biliDownload = useBilibiliDownloadVideo();
  const tiktokParse = useTiktokParse();
  const tiktokDownload = useTiktokDownload();

  const { data: biliHistory = [] } = useHistory({ entityType: 'bilibili-video', limit: 5 });
  const { data: tiktokHistory = [] } = useHistory({ entityType: 'tiktok-video', limit: 5 });
  const history = [...biliHistory, ...tiktokHistory]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const handleParse = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    const source = detectDownloadSource(trimmed);
    if (source === 'unknown') {
      toast({
        title: 'Không nhận diện được link',
        description: 'Dán URL Bilibili hoặc TikTok (hoặc BV id)',
        variant: 'error',
      });
      return;
    }

    setParsing(true);
    setParsed(null);
    try {
      if (source === 'bilibili') {
        const r = await biliParse.mutateAsync({ url: trimmed });
        const data = r.data as BilibiliVideoInfo;
        setParsed({ source: 'bilibili', data });
        toast({
          title: '✓ Đã phân tích Bilibili',
          description: data.title.slice(0, 50),
          variant: 'success',
        });
      } else {
        const r = await tiktokParse.mutateAsync({ url: trimmed });
        setParsed({ source: 'tiktok', data: r.data });
        toast({
          title: '✓ Đã phân tích TikTok',
          description: `${r.data.author} — ${r.data.title.slice(0, 50)}`,
          variant: 'success',
        });
      }
    } catch (err) {
      toast({
        title: 'Lỗi phân tích URL',
        description: err instanceof Error ? err.message : '',
        variant: 'error',
        duration: 8000,
      });
    } finally {
      setParsing(false);
    }
  };

  const pushDownload = (item: DownloadItem) => {
    setDownloads((d) => [item, ...d]);
  };

  const updateDownload = (jobId: string, updates: Partial<DownloadItem>) => {
    setDownloads((d) =>
      d.map((item) => (item.jobId === jobId ? { ...item, ...updates } : item))
    );
  };

  const handleBiliDownload = async (targetUrl: string, title: string) => {
    const filename = title.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 80);
    // Generate a stable jobId so the React side and the server share the same key.
    const jobId = `bili-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Add pending item
    pushDownload({
      jobId,
      filename,
      filePath: '',
      fileSize: 0,
      durationMs: 0,
      source: 'bilibili',
      kind: 'video',
      status: 'downloading',
    });
    setActiveJobIds((ids) => (ids.includes(jobId) ? ids : [...ids, jobId]));

    try {
      const r = await biliDownload.mutateAsync({
        url: targetUrl,
        filename,
        jobId,
      });

      const finalFilename = r.data.filePath.split(/[/\\]/).pop() || filename;
      updateDownload(jobId, {
        filename: finalFilename,
        filePath: r.data.filePath,
        fileSize: r.data.fileSize,
        durationMs: r.data.durationMs,
        source: r.data.source,
        status: 'success',
      });
      setActiveJobIds((ids) => ids.filter((id) => id !== jobId));

      toast({
        title: '✓ Đã tải xong video Bilibili',
        description: `${finalFilename} - ${(r.data.fileSize / 1024 / 1024).toFixed(2)} MB`,
        variant: 'success',
        duration: 4000,
      });
      notifyNative('Đã tải xong video Bilibili', finalFilename);
    } catch (err) {
      updateDownload(jobId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Lỗi không xác định',
      });
      setActiveJobIds((ids) => ids.filter((id) => id !== jobId));

      toast({
        title: 'Lỗi tải video',
        description: `${title}: ${err instanceof Error ? err.message : ''}`,
        variant: 'error',
        duration: 6000,
      });
      throw err;
    }
  };

  const handleTiktokDownload = async (kind: 'video' | 'music') => {
    if (!parsed || parsed.source !== 'tiktok') return;
    const info = parsed.data;
    const baseFilename = kind === 'music'
      ? `tiktok-music-${info.id || 'audio'}`
      : `tiktok-${info.id || 'video'}`;
    const jobId = `tt-${info.id || Date.now()}-${kind}-${Math.random().toString(36).slice(2, 6)}`;

    pushDownload({
      jobId,
      filename: baseFilename,
      filePath: '',
      fileSize: 0,
      durationMs: 0,
      source: 'tiktok',
      kind,
      status: 'downloading',
    });
    setActiveJobIds((ids) => (ids.includes(jobId) ? ids : [...ids, jobId]));

    try {
      const r = await tiktokDownload.mutateAsync({
        url: info.url,
        music: kind === 'music',
        filename: baseFilename,
        jobId,
      });
      const finalFilename = r.data.filePath.split(/[/\\]/).pop() || baseFilename;
      updateDownload(jobId, {
        filename: finalFilename,
        filePath: r.data.filePath,
        fileSize: r.data.fileSize,
        durationMs: r.data.durationMs,
        source: r.data.source,
        kind,
        status: 'success',
      });
      setActiveJobIds((ids) => ids.filter((id) => id !== jobId));
      notifyNative(`Đã tải xong ${kind === 'music' ? 'nhạc' : 'video'} TikTok`, finalFilename);
      toast({
        title: `✓ Đã tải xong ${kind === 'music' ? 'nhạc' : 'video'} TikTok`,
        description: `${(r.data.fileSize / 1024 / 1024).toFixed(2)} MB trong ${(r.data.durationMs / 1000).toFixed(1)}s`,
        variant: 'success',
        duration: 6000,
      });
    } catch (err) {
      updateDownload(jobId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Lỗi không xác định',
      });
      setActiveJobIds((ids) => ids.filter((id) => id !== jobId));
      toast({
        title: `Lỗi tải ${kind}`,
        description: err instanceof Error ? err.message : '',
        variant: 'error',
        duration: 8000,
      });
    }
  };

  // ── Batch: parse nhiều URL cùng lúc ───────────────────────────────────────
  const handleBatchParse = async () => {
    // Mỗi dòng có thể lẫn text khác (caption, tên người gửi...) — chỉ lấy phần URL.
    // Dòng không chứa URL (VD bare BV id) thì giữ nguyên. Bỏ qua link trùng.
    const rawLines = batchInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const line of rawLines) {
      const found = extractUrls(line);
      const candidates = found.length > 0 ? found : [line];
      for (const candidate of candidates) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          urls.push(candidate);
        }
      }
    }
    if (urls.length === 0) {
      toast({ title: 'Chưa có link nào', variant: 'error' });
      return;
    }

    setBatchParsing(true);
    // Khởi tạo queue: tất cả ở status 'queued'
    const initial: BatchItem[] = urls.map((u, i) => ({
      id: `${Date.now()}-${i}`,
      url: u,
      source: detectDownloadSource(u) === 'tiktok' ? 'tiktok'
        : detectDownloadSource(u) === 'bilibili' ? 'bilibili'
        : 'unknown',
      status: 'queued',
    }));
    setBatchItems(initial);

    let okCount = 0;
    let failCount = 0;

    // Parse từng link một (không song song) — parse song song hay bị TikWM/yt-dlp
    // trả lỗi "Could not fetch..." vì gửi nhiều request cùng lúc dễ bị nguồn chặn/hạn chế.
    for (const item of initial) {
      setBatchItems((prev) => prev.map((it) =>
        it.id === item.id ? { ...it, status: 'parsing' } : it
      ));
      try {
        if (item.source === 'bilibili') {
          const r = await biliParse.mutateAsync({ url: item.url });
          const data = r.data as BilibiliVideoInfo;
          setBatchItems((prev) => prev.map((it) =>
            it.id === item.id ? {
              ...it,
              status: 'parsed',
              title: data.title,
              cover: data.cover,
              author: data.uploader,
              duration: data.duration,
              episodeCount: data.episodes?.length || 1,
            } : it
          ));
        } else if (item.source === 'tiktok') {
          const r = await tiktokParse.mutateAsync({ url: item.url });
          setBatchItems((prev) => prev.map((it) =>
            it.id === item.id ? {
              ...it,
              status: 'parsed',
              title: r.data.title,
              cover: r.data.cover,
              author: r.data.author,
              duration: r.data.duration,
              episodeCount: 1,
            } : it
          ));
        } else {
          throw new Error('Không nhận diện được nguồn (cần Bilibili hoặc TikTok)');
        }
        okCount++;
      } catch (err) {
        failCount++;
        setBatchItems((prev) => prev.map((it) =>
          it.id === item.id ? {
            ...it,
            status: 'error',
            error: err instanceof Error ? err.message : 'Lỗi parse',
          } : it
        ));
      }
    }
    setBatchParsing(false);
    toast({
      title: `Phân tích xong ${okCount + failCount} link`,
      description: `Thành công: ${okCount}, Lỗi: ${failCount}`,
      variant: failCount > 0 ? 'warning' : 'success',
    });
  };

  // ── Batch: dịch tên phim (AI) cho các link đã parse thành công ──────────
  const handleBatchTranslate = async () => {
    const targets = batchItems.filter((it) => it.status === 'parsed' && it.title && !it.translatedTitle);
    if (targets.length === 0) {
      toast({ title: 'Không có tên phim nào cần dịch', variant: 'error' });
      return;
    }

    setBatchTranslating(true);
    let okCount = 0;
    let failCount = 0;
    let keyRemovedCount = 0;

    // Dịch từng cái một (không song song) để không đập nhiều request cùng lúc
    // vào cùng 1 API key và bị Google giới hạn/khoá quyền truy cập.
    for (const item of targets) {
      try {
        const r = await batchTranslateMut.mutateAsync({ text: item.title!, model: 'gemini-3.1-flash-lite-preview' });
        setBatchItems((prev) => prev.map((it) =>
          it.id === item.id ? { ...it, translatedTitle: r.data.target, error: undefined } : it
        ));
        okCount++;
      } catch (err) {
        failCount++;
        const message = err instanceof Error ? err.message : 'Lỗi dịch';
        // Key bị 403/PERMISSION_DENIED thì server đã tự xoá key đó khỏi danh sách rồi —
        // chỉ cần báo cho người dùng biết để họ thêm key khác nếu cần.
        if (/PERMISSION_DENIED|API_KEY_INVALID|403/i.test(message)) keyRemovedCount++;
        setBatchItems((prev) => prev.map((it) =>
          it.id === item.id ? { ...it, error: message } : it
        ));
      }
    }
    setBatchTranslating(false);
    if (keyRemovedCount > 0) {
      toast({
        title: 'Đã tự xoá API key bị lỗi',
        description: `${keyRemovedCount} lần dịch gặp key bị từ chối quyền truy cập (403) — key đó đã bị xoá khỏi danh sách. Thêm key Gemini khác trong Cài đặt nếu cần.`,
        variant: 'warning',
        duration: 8000,
      });
    }
    notifyNative(`Đã dịch ${okCount + failCount} tên phim`, `Thành công: ${okCount}, Lỗi: ${failCount}`);
    toast({
      title: `Đã dịch ${okCount + failCount} tên phim`,
      description: `Thành công: ${okCount}, Lỗi: ${failCount}`,
      variant: failCount > 0 ? 'warning' : 'success',
    });
  };

  // ── Batch: tải tất cả các link đã parse thành công ──────────────────────
  const handleBatchDownload = async () => {
    const targets = batchItems.filter((it) => it.status === 'parsed');
    if (targets.length === 0) {
      toast({ title: 'Không có link nào sẵn sàng tải', variant: 'error' });
      return;
    }

    setBatchDownloading(true);
    const concurrency = 3; // tải 3 file cùng lúc
    let successCount = 0;
    let failCount = 0;

    const queue = [...targets];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        setBatchItems((prev) => prev.map((it) =>
          it.id === item.id ? { ...it, status: 'downloading' } : it
        ));

        const jobId = `batch-${item.id}`;
        const displayName = item.translatedTitle || item.title || '';
        // Push vào danh sách "File đã tải" chung để hiển thị progress realtime
        pushDownload({
          jobId,
          filename: (displayName || item.url).replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 80),
          filePath: '',
          fileSize: 0,
          durationMs: 0,
          source: item.source,
          kind: 'video',
          status: 'downloading',
        });
        setActiveJobIds((ids) => (ids.includes(jobId) ? ids : [...ids, jobId]));

        try {
          if (item.source === 'bilibili') {
            const r = await biliDownload.mutateAsync({
              url: item.url,
              filename: displayName.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 80),
              jobId,
            });
            updateDownload(jobId, {
              filename: r.data.filePath.split(/[/\\]/).pop() || displayName,
              filePath: r.data.filePath,
              fileSize: r.data.fileSize,
              durationMs: r.data.durationMs,
              source: r.data.source,
              status: 'success',
            });
            setActiveJobIds((ids) => ids.filter((id) => id !== jobId));
            setBatchItems((prev) => prev.map((it) =>
              it.id === item.id ? {
                ...it,
                status: 'success',
                jobId,
                filePath: r.data.filePath,
                fileSize: r.data.fileSize,
              } : it
            ));
            successCount++;
          } else if (item.source === 'tiktok') {
            const r = await tiktokDownload.mutateAsync({
              url: item.url,
              filename: displayName.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 80),
              jobId,
            });
            updateDownload(jobId, {
              filename: r.data.filePath.split(/[/\\]/).pop() || displayName,
              filePath: r.data.filePath,
              fileSize: r.data.fileSize,
              durationMs: r.data.durationMs,
              source: r.data.source,
              status: 'success',
            });
            setActiveJobIds((ids) => ids.filter((id) => id !== jobId));
            setBatchItems((prev) => prev.map((it) =>
              it.id === item.id ? {
                ...it,
                status: 'success',
                jobId,
                filePath: r.data.filePath,
                fileSize: r.data.fileSize,
              } : it
            ));
            successCount++;
          }
        } catch (err) {
          failCount++;
          const errMsg = err instanceof Error ? err.message : 'Lỗi tải';
          updateDownload(jobId, { status: 'error', error: errMsg });
          setActiveJobIds((ids) => ids.filter((id) => id !== jobId));
          setBatchItems((prev) => prev.map((it) =>
            it.id === item.id ? { ...it, status: 'error', error: errMsg } : it
          ));
        }
      }
    });
    await Promise.all(workers);
    setBatchDownloading(false);
    notifyNative(`Tải xong ${successCount + failCount} file`, `Thành công: ${successCount}, Lỗi: ${failCount}`);
    toast({
      title: `Tải xong ${successCount + failCount} file`,
      description: `Thành công: ${successCount}, Lỗi: ${failCount}`,
      variant: failCount > 0 ? 'warning' : 'success',
      duration: 6000,
    });
  };

  const handleBatchClear = () => {
    setBatchItems([]);
    setBatchInput('');
  };

  return (
    <PageContainer>
      <PageHeader
        title="Tải phim"
        description="Dán link Bilibili hoặc TikTok — tự nhận diện nguồn và tải video"
        icon={<CloudDownload size={18} />}
      />
      <PageContent>
        <Card className="mb-4">
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleParse()}
                  placeholder="Dán link Bilibili / TikTok hoặc BV id..."
                  className="h-10 pl-9"
                />
              </div>
              {detected !== 'unknown' && (
                <Badge variant={detected === 'tiktok' ? 'info' : 'violet'} size="sm" className="shrink-0">
                  {detected === 'tiktok' ? <Music size={10} /> : <Tv size={10} />}
                  {sourceLabel(detected)}
                </Badge>
              )}
              <Button variant="primary" onClick={handleParse} loading={parsing} className="h-10">
                <Search size={14} />
                Phân tích
              </Button>
            </div>
            <p className="text-2xs text-zinc-500 mt-2">
              Hỗ trợ Bilibili (<code className="text-violet-400">bilibili.com</code>,{' '}
              <code className="text-violet-400">b23.tv</code>, <code className="text-violet-400">BV...</code>)
              và TikTok (<code className="text-violet-400">tiktok.com</code>,{' '}
              <code className="text-violet-400">vm.tiktok.com</code>).
            </p>
          </CardContent>
        </Card>

        {parsed?.source === 'bilibili' && (
          <BilibiliResult
            info={parsed.data}
            downloading={biliDownload.isPending}
            onDownload={handleBiliDownload}
          />
        )}

        {parsed?.source === 'tiktok' && (
          <TiktokResult
            info={parsed.data}
            downloading={tiktokDownload.isPending}
            onDownload={handleTiktokDownload}
          />
        )}

        {!parsed && !parsing && (
          <Card>
            <EmptyState
              icon={<CloudDownload size={48} />}
              title="Dán link để bắt đầu"
              description="Hệ thống tự nhận Bilibili hoặc TikTok, lấy siêu dữ liệu rồi tải MP4 (TikTok thêm MP3)"
            />
          </Card>
        )}

        {parsing && (
          <Card>
            <EmptyState
              icon={<Loader2 size={36} className="animate-spin" />}
              title={`Đang phân tích ${sourceLabel(detected)}...`}
              description="Đang lấy siêu dữ liệu từ nguồn tương ứng"
            />
          </Card>
        )}

        {/* ── Tải nhiều link cùng lúc ─────────────────────────────────────── */}
        <Card className="mb-4 mt-4">
          <CardHeader>
            <CardTitle>Tải nhiều link cùng lúc</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="violet" size="sm">
                <Layers size={10} /> Batch
              </Badge>
              {batchItems.length > 0 && (
                <Badge variant="info" size="sm">
                  {batchItems.filter((it) => it.status === 'parsed').length}/{batchItems.length} sẵn sàng
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full min-h-[100px] rounded-md border border-[#2b2d31] bg-[#131416] px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40 resize-y"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                const extracted = extractUrls(pasted);
                // Chỉ can thiệp khi nội dung dán có URL lẫn text khác;
                // dán thuần list link/BV id thì để hành vi paste mặc định.
                if (extracted.length === 0) return;
                e.preventDefault();
                const existing = batchInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
                const seen = new Set(existing);
                const merged = [...existing];
                for (const url of extracted) {
                  if (!seen.has(url)) {
                    seen.add(url);
                    merged.push(url);
                  }
                }
                setBatchInput(merged.join('\n'));
              }}
              placeholder={
                'Dán nhiều link, mỗi link 1 dòng (hoặc cách nhau bằng dấu phẩy):\n' +
                'https://www.tiktok.com/@user/video/123\n' +
                'https://www.bilibili.com/video/BV1xxx\n' +
                'https://b23.tv/abc'
              }
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBatchParse}
                loading={batchParsing}
                disabled={!batchInput.trim() || batchParsing}
              >
                <Search size={12} />
                Phân tích tất cả
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBatchTranslate}
                loading={batchTranslating}
                disabled={
                  batchItems.filter((it) => it.status === 'parsed' && !it.translatedTitle).length === 0 ||
                  batchTranslating
                }
              >
                <Languages size={12} />
                Dịch tên phim ({batchItems.filter((it) => it.status === 'parsed' && !it.translatedTitle).length})
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBatchDownload}
                loading={batchDownloading}
                disabled={batchItems.filter((it) => it.status === 'parsed').length === 0 || batchDownloading}
              >
                <Download size={12} />
                Tải tất cả ({batchItems.filter((it) => it.status === 'parsed').length})
              </Button>
              {batchItems.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBatchClear}
                  disabled={batchParsing || batchDownloading}
                >
                  Xóa danh sách
                </Button>
              )}
              <span className="text-2xs text-zinc-500 ml-auto">
                Parse: từng link một • Tải: 3 file cùng lúc
              </span>
            </div>

            {/* Danh sách kết quả batch */}
            {batchItems.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {batchItems.map((item) => (
                  <BatchItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {downloads.length > 0 && (
          <Card className="mb-4 mt-4">
            <CardHeader>
              <CardTitle>File đã tải</CardTitle>
              <Badge variant="success" size="sm">{downloads.length} file</Badge>
            </CardHeader>
            <CardContent className="!p-0">
              <div className="divide-y divide-[#2b2d31]">
                {downloads.map((d) => (
                  <DownloadRow
                    key={d.jobId}
                    item={d}
                    isActive={activeJobIds.includes(d.jobId)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {history.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Lịch sử tải gần đây</CardTitle>
            </CardHeader>
            <CardContent className="!p-0">
              <div className="divide-y divide-[#2b2d31] max-h-60 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <Badge variant="success" size="sm">tải xuống</Badge>
                    <span className="text-zinc-200 truncate flex-1">{h.entityName}</span>
                    {h.details && <span className="text-zinc-500 truncate max-w-xs">{h.details}</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageContainer>
  );
}

// ============================================================================
// DownloadRow — một dòng trong danh sách "File đã tải"
// Hiển thị realtime progress (percent, bytes received/total, tốc độ)
// dựa trên polling hook useDownloadStatus. Khi Supabase Realtime bật,
// backend broadcast event 'downloads:progress' sẽ invalidate query
// ngay lập tức → progress bar cập nhật < 250ms thay vì 2s polling.
// ============================================================================
function DownloadRow({ item, isActive }: { item: DownloadItem; isActive: boolean }) {
  // Poll progress khi job đang active. Hook tự dừng khi không active.
  const { data: progress } = useDownloadStatus(isActive ? item.jobId : null, isActive, 2000);

  const isDownloading = item.status === 'downloading' || isActive;
  const isError = item.status === 'error';
  const isSuccess = item.status === 'success';

  // ── Format helpers ───────────────────────────────────────────────────────
  const formatBytes = (b: number): string => {
    if (!b || b <= 0) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };
  const formatSpeed = (bps: number): string => {
    if (!bps || bps <= 0) return '—';
    if (bps < 1024) return `${bps.toFixed(0)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
  };
  const formatDuration = (ms: number): string => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  };

  // ── Live progress numbers (từ polling/realtime) ─────────────────────────
  const percent = progress?.percent ?? (isSuccess ? 100 : 0);
  const received = progress?.receivedBytes ?? item.fileSize ?? 0;
  const total = progress?.totalBytes ?? 0;
  const speed = progress?.speedBps ?? 0;
  const status = progress?.status ?? (isSuccess ? 'completed' : isError ? 'error' : 'queued');

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      {/* Icon trạng thái */}
      <div className="shrink-0 mt-0.5">
        {isDownloading && <Loader2 size={16} className="text-violet-400 animate-spin" />}
        {isSuccess && <CheckCircle2 size={16} className="text-emerald-400" />}
        {isError && <AlertTriangle size={16} className="text-rose-400" />}
      </div>

      {/* Thông tin + progress bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-zinc-200 truncate font-medium">
              {item.filename}
            </span>
            <Badge
              variant={
                status === 'completed' ? 'success'
                : status === 'error' ? 'error'
                : status === 'downloading' ? 'violet'
                : 'default'
              }
              size="sm"
            >
              {item.source} · {item.kind === 'music' ? 'MP3' : 'MP4'}
            </Badge>
          </div>
          <span className="text-2xs text-zinc-500 font-mono shrink-0">
            {Math.round(percent)}%
          </span>
        </div>

        {/* Progress bar */}
        {(isDownloading || isSuccess) && (
          <div className="h-1.5 rounded-full bg-[#2b2d31] overflow-hidden mb-1.5">
            <div
              className={`h-full transition-all duration-200 ${
                isError
                  ? 'bg-rose-500'
                  : isSuccess
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-violet-500 to-violet-400'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
        )}

        {/* Live stats */}
        <div className="flex items-center gap-3 text-2xs text-zinc-500 font-mono">
          {isDownloading && (
            <>
              <span>
                {formatBytes(received)}
                {total > 0 ? ` / ${formatBytes(total)}` : ''}
              </span>
              <span>·</span>
              <span>{formatSpeed(speed)}</span>
              {progress?.updatedAt && (
                <>
                  <span>·</span>
                  <span>cập nhật {new Date(progress.updatedAt).toLocaleTimeString('vi-VN')}</span>
                </>
              )}
            </>
          )}
          {isSuccess && (
            <>
              <span>{formatBytes(item.fileSize)}</span>
              {item.durationMs > 0 && (
                <>
                  <span>·</span>
                  <span>{formatDuration(item.durationMs)}</span>
                </>
              )}
              {item.filePath && (
                <>
                  <span>·</span>
                  <span className="truncate" title={item.filePath}>
                    📁 {item.filePath}
                  </span>
                </>
              )}
            </>
          )}
          {isError && (
            <span className="text-rose-400">
              {item.error || 'Lỗi không xác định'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BilibiliResult({
  info,
  downloading,
  onDownload,
}: {
  info: BilibiliVideoInfo;
  downloading: boolean;
  onDownload: (targetUrl: string, title: string) => Promise<void>;
}) {
  const translateMut = useAITranslate();
  const { toast } = useToast();
  const { data: settings } = useSettings();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [translatedTitle, setTranslatedTitle] = useState('');
  const [translatedEpisodes, setTranslatedEpisodes] = useState<Record<number, string>>({});
  const [translatingTitles, setTranslatingTitles] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [downloadStats, setDownloadStats] = useState({ completed: 0, failed: 0, total: 0 });

  useEffect(() => {
    setSelectedIds(info.episodes.map((ep) => ep.id));
    setTranslatedTitle('');
    setTranslatedEpisodes({});
  }, [info]);

  const selectedEpisodes = info.episodes.filter((ep) => selectedIds.includes(ep.id));

  const toggleEpisode = (id: number) => {
    setSelectedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ));
  };

  const handleTranslateTitles = async () => {
    setTranslatingTitles(true);
    try {
      const titleResult = await translateMut.mutateAsync({ text: info.title, model: 'gemini-3.1-flash-lite-preview' });
      setTranslatedTitle(titleResult.data.target);

      const nextEpisodes: Record<number, string> = {};
      const targets = selectedEpisodes.length > 0 ? selectedEpisodes : info.episodes;
      for (const episode of targets) {
        const translated = await translateMut.mutateAsync({
          text: episode.title,
          model: 'gemini-3.1-flash-lite-preview',
        });
        nextEpisodes[episode.id] = translated.data.target;
      }
      setTranslatedEpisodes(nextEpisodes);
      toast({
        title: 'Đã dịch tên phim',
        description: `${targets.length} tập đã được cập nhật tên tiếng Việt`,
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Lỗi dịch tên phim',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    } finally {
      setTranslatingTitles(false);
    }
  };

  const handleDownloadSelected = async () => {
    const targets = selectedEpisodes.length > 0 ? selectedEpisodes : info.episodes;
    if (targets.length === 0) {
      toast({
        title: 'Chưa chọn tập nào',
        description: 'Hãy tick ít nhất một tập trước khi tải.',
        variant: 'error',
      });
      return;
    }

    setBatchDownloading(true);
    setDownloadStats({ completed: 0, failed: 0, total: targets.length });

    // Get concurrency from settings (default 3)
    const concurrency = settings?.downloadConcurrency || 3;

    toast({
      title: `Bắt đầu tải ${targets.length} tập`,
      description: `Đang tải song song tối đa ${concurrency} video cùng lúc...`,
      variant: 'info',
      duration: 3000,
    });

    // Download in parallel with max concurrency
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const promises = batch.map(async (episode, batchIndex) => {
        const index = i + batchIndex;
        const targetUrl = episode.url || (episode.bvid
          ? `https://www.bilibili.com/video/${episode.bvid}`
          : `https://www.bilibili.com/video/av${episode.aid}`);
        const translatedEpisodeTitle = translatedEpisodes[episode.id];
        const filename = `${info.kind === 'bangumi' ? 'bangumi' : 'bilibili'}-${index + 1}-${translatedEpisodeTitle || episode.title}`;
        
        try {
          await onDownload(targetUrl, filename);
          completed++;
          setDownloadStats({ completed, failed, total: targets.length });
        } catch (err) {
          failed++;
          setDownloadStats({ completed, failed, total: targets.length });
        }
      });

      await Promise.all(promises);
    }

    setBatchDownloading(false);

    if (failed === 0) {
      toast({
        title: '✓ Hoàn thành tải xuống',
        description: `Đã tải thành công ${completed}/${targets.length} tập`,
        variant: 'success',
        duration: 5000,
      });
    } else {
      toast({
        title: 'Tải xuống hoàn tất với lỗi',
        description: `Thành công: ${completed}, Lỗi: ${failed}`,
        variant: 'warning',
        duration: 5000,
      });
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Siêu dữ liệu video</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="violet" size="sm"><Tv size={10} /> Bilibili</Badge>
          <Badge variant="info" size="sm">{info.kind}</Badge>
          <Badge variant="cyan" size="sm">
            <Eye size={10} /> {info.episodes.length} tập
          </Badge>
          {info.isPlaylist && (
            <Badge variant="success" size="sm">
              <ListChecks size={10} /> Playlist
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <div className="w-64 aspect-video rounded-md overflow-hidden bg-black shrink-0">
            <img src={info.cover} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-zinc-100 mb-1 line-clamp-2">
              {translatedTitle || info.title}
            </h3>
            {translatedTitle && (
              <p className="text-xs text-zinc-500 mb-2 line-clamp-2">{info.title}</p>
            )}
            <div className="space-y-1 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <User size={12} />
                <span className="text-zinc-300">{info.uploader}</span>
                <span className="text-zinc-600">·</span>
                <span>MID: {info.uploaderMid}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={12} />
                <span>{formatDuration(info.duration * 1000)}</span>
                <span className="text-zinc-600">·</span>
                <span>BV: {info.bvid}</span>
                <span className="text-zinc-600">·</span>
                <span>AV: {info.aid}</span>
              </div>
              {info.desc && (
                <p className="text-zinc-500 line-clamp-3 mt-2">{info.desc}</p>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button
                variant="primary"
                size="sm"
                onClick={handleDownloadSelected}
                loading={batchDownloading}
                disabled={downloading}
              >
                <Download size={12} />
                {info.episodes.length > 1 ? `Tải tập đã chọn (${selectedEpisodes.length || info.episodes.length})` : 'Tải video (MP4)'}
              </Button>
              {batchDownloading && downloadStats.total > 0 && (
                <Badge variant="info" size="sm">
                  {downloadStats.completed}/{downloadStats.total}
                  {downloadStats.failed > 0 && ` (${downloadStats.failed} lỗi)`}
                </Badge>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTranslateTitles}
                loading={translatingTitles}
                disabled={batchDownloading}
              >
                <Languages size={12} />
                Dịch tên phim
              </Button>
              <a
                href={info.episodes[0]?.url || `https://www.bilibili.com/video/${info.bvid}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary h-7 px-2.5 text-xs"
              >
                <ExternalLink size={10} /> Mở trên Bilibili
              </a>
            </div>
          </div>
        </div>

        {info.episodes.length > 0 && (
          <div className="mt-4 border-t border-[#2b2d31] pt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold text-zinc-300">Danh sách tập</h4>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(info.episodes.map((ep) => ep.id))}>
                Chọn tất cả
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                Bỏ chọn
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {info.episodes.map((ep, idx) => (
                <div
                  key={ep.id}
                  className={`rounded-md border bg-[#131416] p-2 transition-colors ${
                    selectedIds.includes(ep.id)
                      ? 'border-violet-500/60 ring-1 ring-violet-500/30'
                      : 'border-[#2b2d31] hover:border-violet-500/40'
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => toggleEpisode(ep.id)}
                  >
                    <div className="aspect-video bg-black rounded mb-1.5 overflow-hidden">
                      {ep.cover && <img src={ep.cover} alt="" className="w-full h-full object-cover" />}
                    </div>
                  </button>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedIds.includes(ep.id)}
                      onChange={() => toggleEpisode(ep.id)}
                    />
                    <div className="min-w-0">
                      {ep.sectionTitle && (
                        <div className="text-2xs text-violet-300 truncate">{ep.sectionTitle}</div>
                      )}
                      <div className="text-xs font-medium text-zinc-200 truncate">
                        #{idx + 1} {translatedEpisodes[ep.id] || ep.title}
                      </div>
                      {translatedEpisodes[ep.id] && (
                        <div className="text-2xs text-zinc-500 truncate">{ep.title}</div>
                      )}
                      <div className="text-2xs text-zinc-500">{formatDuration(ep.duration * 1000)}</div>
                    </div>
                  </label>
                  <div className="mt-1.5 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => onDownload(
                        ep.url || (ep.bvid ? `https://www.bilibili.com/video/${ep.bvid}` : `https://www.bilibili.com/video/av${ep.aid}`),
                        translatedEpisodes[ep.id] || ep.title,
                      )}
                    >
                      <Download size={10} /> Tải riêng
                    </Button>
                    {ep.url && (
                      <a
                        href={ep.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost h-7 px-2 text-xs"
                      >
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TiktokResult({
  info,
  downloading,
  onDownload,
}: {
  info: TiktokVideoInfo;
  downloading: boolean;
  onDownload: (kind: 'video' | 'music') => void;
}) {
  const translateMut = useAITranslate();
  const { toast } = useToast();
  const [translatedTitle, setTranslatedTitle] = useState('');
  const [translating, setTranslating] = useState(false);

  const handleTranslateTitle = async () => {
    setTranslating(true);
    try {
      // Dịch cả title + author sang tiếng Việt (nếu là tiếng Trung/Anh)
      const titleResult = await translateMut.mutateAsync({
        text: info.title || '',
        model: 'gemini-3.1-flash-lite-preview',
      });
      setTranslatedTitle(titleResult.data.target);
      toast({
        title: 'Đã dịch tên phim',
        description: titleResult.data.target.slice(0, 60),
        variant: 'success',
      });
    } catch (err) {
      toast({
        title: 'Lỗi dịch tên phim',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      });
    } finally {
      setTranslating(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Siêu dữ liệu video</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="info" size="sm"><Music size={10} /> TikTok</Badge>
          {info.region && (
            <Badge variant="cyan" size="sm">{info.region}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          <div className="w-32 aspect-[9/16] rounded-md overflow-hidden bg-black shrink-0 relative">
            <img src={info.cover} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Play size={20} className="text-white/90" fill="currentColor" />
            </div>
            <div className="absolute bottom-1 right-1 bg-black/80 text-white text-2xs px-1.5 py-0.5 rounded">
              {formatDuration(info.duration * 1000)}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-zinc-100 mb-2 line-clamp-2">
              {translatedTitle || info.title || '(không có tiêu đề)'}
            </h3>
            {translatedTitle && (
              <p className="text-xs text-zinc-500 mb-2 line-clamp-2">{info.title}</p>
            )}
            <div className="space-y-1.5 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <User size={12} />
                <span className="text-zinc-300">{info.author}</span>
                <span className="text-zinc-600">·</span>
                <span>@{info.authorId}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {info.viewCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <Eye size={11} /> {info.viewCount.toLocaleString()}
                  </span>
                )}
                {info.likeCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <Heart size={11} /> {info.likeCount.toLocaleString()}
                  </span>
                )}
                {info.commentCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <MessageCircle size={11} /> {info.commentCount.toLocaleString()}
                  </span>
                )}
                {info.shareCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <Share2 size={11} /> {info.shareCount.toLocaleString()}
                  </span>
                )}
              </div>
              {info.createdAt && (
                <div className="flex items-center gap-1 text-2xs text-zinc-500">
                  <Clock size={10} /> Đăng {timeAgo(new Date(info.createdAt * 1000).toISOString())}
                </div>
              )}
              {info.musicTitle && (
                <div className="flex items-center gap-1.5 text-zinc-300">
                  <Music size={11} />
                  <span>{info.musicTitle}</span>
                  {info.musicAuthor && <span className="text-zinc-500">— {info.musicAuthor}</span>}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                onClick={() => onDownload('video')}
                loading={downloading}
              >
                <Download size={12} />
                Tải video (MP4)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDownload('music')}
                loading={downloading}
                disabled={!info.musicUrl}
              >
                <Headphones size={12} />
                Tải nhạc (MP3)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTranslateTitle}
                loading={translating}
                disabled={translating}
              >
                <Languages size={12} />
                Dịch tên phim
              </Button>
              <a
                href={info.url}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost h-7 px-2.5 text-xs"
              >
                <ExternalLink size={10} /> Mở trên TikTok
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// BatchItemRow — 1 dòng trong danh sách "Tải nhiều link cùng lúc"
// Hiển thị: thumbnail, title, source badge, status icon, error (nếu có)
// ============================================================================
function BatchItemRow({ item }: { item: BatchItem }) {
  const statusMeta = {
    queued:      { icon: <Clock size={12} className="text-zinc-500" />,         label: 'Đang chờ',    color: 'text-zinc-400' },
    parsing:     { icon: <Loader2 size={12} className="animate-spin text-violet-400" />, label: 'Đang phân tích', color: 'text-violet-300' },
    parsed:      { icon: <CheckCircle2 size={12} className="text-emerald-400" />, label: 'Sẵn sàng',   color: 'text-emerald-300' },
    downloading: { icon: <Loader2 size={12} className="animate-spin text-violet-400" />, label: 'Đang tải',  color: 'text-violet-300' },
    success:     { icon: <CheckCircle2 size={12} className="text-emerald-400" />, label: 'Xong',       color: 'text-emerald-300' },
    error:       { icon: <AlertTriangle size={12} className="text-rose-400" />,  label: 'Lỗi',         color: 'text-rose-300' },
  }[item.status];

  const sourceBadge = item.source === 'tiktok'
    ? <Badge variant="info" size="sm"><Music size={10} /> TikTok</Badge>
    : item.source === 'bilibili'
      ? <Badge variant="violet" size="sm"><Tv size={10} /> Bilibili</Badge>
      : <Badge variant="default" size="sm">?</Badge>;

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-md border border-[#2b2d31] bg-[#131416] hover:border-violet-500/30 transition-colors">
      {/* Thumbnail */}
      <div className="shrink-0 w-16 h-16 rounded overflow-hidden bg-black">
        {item.cover ? (
          <img src={item.cover} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {item.source === 'tiktok' ? <Music size={18} className="text-zinc-600" /> : <Tv size={18} className="text-zinc-600" />}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {sourceBadge}
          {item.episodeCount && item.episodeCount > 1 && (
            <Badge variant="cyan" size="sm">{item.episodeCount} tập</Badge>
          )}
          <span className={`flex items-center gap-1 text-2xs ${statusMeta.color}`}>
            {statusMeta.icon}
            {statusMeta.label}
          </span>
        </div>
        <div className="text-xs text-zinc-200 truncate font-medium">
          {item.translatedTitle || item.title || item.url}
        </div>
        {item.translatedTitle && item.title && (
          <div className="text-2xs text-zinc-500 truncate">{item.title}</div>
        )}
        <div className="text-2xs text-zinc-500 truncate font-mono mt-0.5">
          {item.url}
        </div>
        {item.author && (
          <div className="text-2xs text-zinc-400 mt-0.5">
            <User size={9} className="inline mr-1" />
            {item.author}
            {item.duration ? ` · ${formatDuration(item.duration * 1000)}` : ''}
          </div>
        )}
        {item.error && (
          <div className="text-2xs text-rose-400 mt-1 truncate" title={item.error}>
            ⚠ {item.error}
          </div>
        )}
        {item.status === 'success' && item.filePath && (
          <div className="text-2xs text-emerald-400 mt-1 truncate" title={item.filePath}>
            ✓ {(item.fileSize ? `${(item.fileSize / 1024 / 1024).toFixed(2)} MB · ` : '')}{item.filePath}
          </div>
        )}
      </div>
    </div>
  );
}
