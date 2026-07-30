import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Key, Palette, Bot, Database, Globe, Cookie, Save,
  RefreshCw, Download, CheckCircle2, AlertTriangle, Sparkles, ExternalLink,
  Folder, FolderOpen, Radio, Wifi, WifiOff,
} from 'lucide-react';
import { useRealtimeStatus, useRealtimeStore } from '../hooks/useRealtimeSync';
import { isRealtimeConfigured } from '../lib/supabase';
import {
  useSettings, useUpdateSettings,
  useCheckForUpdate, useDownloadUpdate, useApplyUpdate, useTestMongo, useUpdateDiagnostics,
  type UpdateCheckResult, type UpdateDiagnostics,
} from '../api/hooks';
import { PageHeader, PageContent, PageContainer } from '../components/Page';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input, Textarea, Field, Badge,
  Skeleton, Tabs, TabsList, TabsTrigger, TabsContent, useToast, Select,
} from '@sleiz/ui';
import {
  AI_DEFAULT_MODELS,
  APP_VERSION,
  formatCost,
  formatTokens,
  resolveAIModel,
  type AppSettings,
} from '@sleiz/shared';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const [tab, setTab] = useState('ai');

  if (isLoading || !settings) {
    return (
      <PageContainer>
        <PageHeader title="Settings" icon={<SettingsIcon size={18} />} />
        <PageContent>
          <Skeleton className="h-96" />
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Cấu hình AI, cập nhật private repo, MongoDB"
        icon={<SettingsIcon size={18} />}
      />
      <PageContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="updates">Updates</TabsTrigger>
            <TabsTrigger value="ai">AI / Gemini</TabsTrigger>
            <TabsTrigger value="translation">Translation</TabsTrigger>
            <TabsTrigger value="realtime">Realtime</TabsTrigger>
            <TabsTrigger value="ui">UI / Theme</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="updates" className="mt-4">
            <UpdatesSettings settings={settings} />
          </TabsContent>
          <TabsContent value="ai" className="mt-4">
            <AISettings />
          </TabsContent>
          <TabsContent value="translation" className="mt-4">
            <TranslationSettings />
          </TabsContent>
          <TabsContent value="realtime" className="mt-4">
            <RealtimeSettings />
          </TabsContent>
          <TabsContent value="ui" className="mt-4">
            <UISettings />
          </TabsContent>
          <TabsContent value="advanced" className="mt-4">
            <DownloadSettings />
            <BilibiliSettings />
            <AdvancedSettings />
          </TabsContent>
        </Tabs>
      </PageContent>
    </PageContainer>
  );
}

// ============================================================================
// Updates Settings — auto-update tab
// ============================================================================
function UpdatesSettings({ settings }: { settings: AppSettings & Record<string, unknown> }) {
  const { toast } = useToast();
  const usePrivateRelease = Boolean(settings.githubPrivateRepo && settings.hasGithubPrivateToken);
  const checkMut = useCheckForUpdate({ preferApi: usePrivateRelease, currentVersion: APP_VERSION });
  const downloadMut = useDownloadUpdate();
  const applyMut = useApplyUpdate();
  const diagMut = useUpdateDiagnostics();
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<UpdateDiagnostics | null>(null);

  // Detect if we're running inside ElectroBun desktop
  const isDesktop = typeof window !== 'undefined' && !!(window as Window).sleiz;

  const handleCheck = async () => {
    try {
      const r = await checkMut.mutateAsync();
      setResult(r);
      if (r.updateAvailable) {
        toast({
          title: 'Có bản cập nhật!',
          description: `v${r.current} → v${r.latest}`,
          variant: 'info',
        });
      } else {
        // Differentiate "no update" reasons so the user knows what to do next.
        const reason = r.source === 'main-branch-package-json'
          ? 'Repo main branch có cùng version với app — bump version trong package.json rồi push lại'
          : r.source === 'github-tag'
            ? 'Repo có tag nhưng chưa có Release assets'
            : r.source === 'public-fallback'
              ? 'Repo chưa có Release/tag — cần tạo GitHub Release để cập nhật'
              : 'Phiên bản hiện tại là mới nhất';
        toast({
          title: 'Không có bản cập nhật mới',
          description: `v${r.current} • ${reason}`,
          variant: 'info',
          duration: 6000,
        });
      }
    } catch (err) {
      toast({
        title: 'Lỗi kiểm tra cập nhật',
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      });
    }
  };

  const handleDiagnostics = async () => {
    try {
      const r = await diagMut.mutateAsync();
      setDiagnostics(r);
      toast({
        title: 'Đã lấy chẩn đoán',
        description: `Repo: ${r.repo} • Releases: ${r.githubReleasesCount} • Tags: ${r.githubTagsCount} • main v${r.mainBranchVersion || '?'}`,
        variant: 'info',
        duration: 8000,
      });
    } catch (err) {
      toast({
        title: 'Lỗi chẩn đoán',
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      });
    }
  };

  const handleDownload = async () => {
    if (usePrivateRelease || (result?.downloads && Object.keys(result.downloads).length > 0)) {
      const entries = Object.entries(result?.downloads || {});
      if (entries.length === 0) {
        toast({ title: 'Không có file cập nhật', variant: 'warning' });
        return;
      }
      const preferred = settings.updateAssetName
        ? entries.find(([name]) => name.toLowerCase().includes(String(settings.updateAssetName).toLowerCase()))
        : null;
      const target = preferred || entries[0];
      const href = target[1].startsWith('http') ? target[1] : `${window.location.origin}${target[1]}`;
      const link = document.createElement('a');
      link.href = href;
      link.click();
      setDownloadProgress(`Đang tải ${target[0]}`);
      toast({ title: 'Bắt đầu tải bản mới', description: target[0], variant: 'success' });
      return;
    }

    setDownloadProgress('Đang tải...');
    try {
      const r = await downloadMut.mutateAsync();
      if (r.ok) {
        setDownloadProgress('Đã tải xong, sẵn sàng cài đặt');
        toast({ title: '✓ Cập nhật đã sẵn sàng', description: 'Bấm "Cài đặt & khởi động lại"', variant: 'success' });
      } else {
        setDownloadProgress(`Lỗi: ${r.error}`);
        toast({ title: 'Lỗi tải cập nhật', description: r.error, variant: 'error' });
      }
    } catch (err) {
      setDownloadProgress(`Lỗi: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleApply = async () => {
    try {
      const r = await applyMut.mutateAsync();
      if (!r.ok) {
        toast({ title: 'Không thể cài đặt', description: r.error, variant: 'error' });
      }
      // If ok, the app will quit and relaunch automatically
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <div className="space-y-3">
      {/* Current version */}
      <Card>
        <CardHeader>
          <CardTitle>Phiên bản hiện tại</CardTitle>
          <Badge variant="violet" size="sm">v{APP_VERSION}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-[#2b2d31] bg-[#131416] p-3">
              <div className="text-2xs text-zinc-500 uppercase mb-1">Phiên bản</div>
              <div className="text-lg font-semibold text-zinc-100">v{APP_VERSION}</div>
            </div>
            <div className="rounded-md border border-[#2b2d31] bg-[#131416] p-3">
              <div className="text-2xs text-zinc-500 uppercase mb-1">Môi trường</div>
              <div className="text-lg font-semibold text-zinc-100">
                {isDesktop ? 'Desktop (ElectroBun)' : 'Web'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Check for updates */}
      <Card>
        <CardHeader>
          <CardTitle>Kiểm tra cập nhật</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDiagnostics}
              loading={diagMut.isPending}
              title="Lấy thông tin chi tiết từ GitHub để hiểu vì sao không có update"
            >
              <Database size={12} />
              Chẩn đoán
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCheck}
              loading={checkMut.isPending}
            >
              <RefreshCw size={12} />
              Kiểm tra ngay
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-md border border-[#2b2d31] bg-[#131416] p-3 text-xs text-zinc-400">
            {usePrivateRelease ? (
              <p>
                Đang dùng private repo <span className="text-zinc-200">{String(settings.githubPrivateRepo)}</span>.
                Hệ thống đọc GitHub Releases qua token và tải asset qua API proxy.
              </p>
            ) : (
              <p>
                Chưa cấu hình private repo. Mặc định app sẽ check repo <span className="text-zinc-200">tuanlinhsfh102-design/SleizUwU</span> (public releases + main branch version).
                Vào tab <b>Advanced</b> để nhập token nếu repo private.
              </p>
            )}
          </div>
          {result ? (
            <div className="space-y-3">
              <div
                className={`flex items-start gap-3 p-3 rounded-md border ${
                  result.updateAvailable
                    ? 'bg-amber-500/5 border-amber-500/30'
                    : 'bg-emerald-500/5 border-emerald-500/30'
                }`}
              >
                {result.updateAvailable ? (
                  <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  {result.updateAvailable ? (
                    <>
                      <p className="text-sm text-zinc-100">
                        Có bản cập nhật mới: <strong>v{result.latest}</strong>
                      </p>
                      <p className="text-2xs text-zinc-500 mt-0.5">
                        Phiên bản hiện tại: v{result.current} • Kênh: {result.channel}
                        {result.source && <span> • Nguồn: <code className="text-violet-400">{result.source}</code></span>}
                        {result.hasAssets === false && <span className="text-amber-400"> • Chưa có file tải về</span>}
                      </p>
                      {result.required && (
                        <p className="text-xs text-rose-400 mt-1">
                          ⚠ Cập nhật bắt buộc (v{result.current} đã lỗi thời)
                        </p>
                      )}
                      {result.notes && (
                        <p className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap">{result.notes}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-100">
                        Không có bản cập nhật mới (v{result.current})
                      </p>
                      <p className="text-2xs text-zinc-500 mt-1">
                        {result.source === 'main-branch-package-json' && (
                          <>Đã check repo <code className="text-violet-400">{result.repo}</code> nhánh main — version khớp với app. </>
                        )}
                        {result.source === 'github-tag' && (
                          <>Repo có tag nhưng chưa có Release assets. </>
                        )}
                        {result.source === 'public-fallback' && (
                          <>Repo chưa có Release/tag nào. Để cập nhật: bump version, push lên main, tạo GitHub Release với tag (vd v{result.current}) và upload file cài đặt. </>
                        )}
                        {result.source === 'github-release' && (
                          <>Đã check GitHub Releases của <code className="text-violet-400">{result.repo}</code>. </>
                        )}
                        Bấm <b>Chẩn đoán</b> để xem chi tiết.
                      </p>
                      {result.notes && (
                        <p className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap">{result.notes}</p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {result.updateAvailable && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownload}
                    loading={!usePrivateRelease && downloadMut.isPending}
                    disabled={result.hasAssets === false}
                    title={result.hasAssets === false ? 'Chưa có file tải về — cần tạo GitHub Release với asset' : undefined}
                  >
                    <Download size={12} />
                    {usePrivateRelease || result.hasAssets ? 'Tải bản mới' : 'Chưa có file để tải'}
                  </Button>
                  {!usePrivateRelease && isDesktop && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleApply}
                      loading={applyMut.isPending}
                      disabled={!downloadProgress?.startsWith('Đã tải xong')}
                    >
                      <Sparkles size={12} />
                      Cài đặt & khởi động lại
                    </Button>
                  )}
                  {downloadProgress && (
                    <span className="text-xs text-zinc-400 ml-2">{downloadProgress}</span>
                  )}
                </div>
              )}

              {result.updateAvailable && !isDesktop && !usePrivateRelease && (
                <div className="flex flex-wrap gap-2">
                  <p className="w-full text-xs text-zinc-400 mb-2">
                    Bạn đang chạy ở chế độ web. Tải bản desktop tương ứng:
                  </p>
                  {Object.entries(result.downloads).map(([platform, url]) => (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary h-8 px-3 text-xs"
                    >
                      <ExternalLink size={10} />
                      {platformLabel(platform)}
                    </a>
                  ))}
                </div>
              )}

              {result.updateAvailable && usePrivateRelease && Object.keys(result.downloads || {}).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <p className="w-full text-xs text-zinc-400 mb-1">
                    Asset từ private release (cũng có thể bấm "Tải bản mới" ở trên):
                  </p>
                  {Object.entries(result.downloads).map(([name, url]) => (
                    <a
                      key={name}
                      href={url.startsWith('http') ? url : `${window.location.origin}${url}`}
                      className="btn-secondary h-8 px-3 text-xs"
                    >
                      <Download size={10} />
                      {name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">
              Bấm "Kiểm tra ngay" để tìm bản cập nhật mới. Tự động kiểm tra mỗi 6 giờ khi chạy desktop.
            </div>
          )}

          {/* Diagnostics panel — shown only after user clicks "Chẩn đoán" */}
          {diagnostics && (
            <div className="mt-4 rounded-md border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-violet-200 uppercase tracking-wider">Chẩn đoán cập nhật</h4>
                <button
                  onClick={() => setDiagnostics(null)}
                  className="text-2xs text-zinc-500 hover:text-zinc-300"
                >
                  Đóng ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">Repo đang check</div>
                  <div className="text-zinc-200 font-mono text-2xs break-all">{diagnostics.repo}</div>
                </div>
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">Token cấu hình</div>
                  <div className={diagnostics.privateRepoConfigured ? 'text-emerald-400' : 'text-zinc-500'}>
                    {diagnostics.privateRepoConfigured ? '✓ Có (đang dùng private mode)' : '✗ Không (dùng public)'}
                  </div>
                </div>
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">Version app hiện tại</div>
                  <div className="text-zinc-200 font-mono">v{diagnostics.clientVersion}</div>
                </div>
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">Version trên main branch</div>
                  <div className={`font-mono ${diagnostics.mainBranchVersion && diagnostics.mainBranchVersion !== diagnostics.clientVersion ? 'text-amber-400' : 'text-zinc-200'}`}>
                    {diagnostics.mainBranchVersion ? `v${diagnostics.mainBranchVersion}` : '(không đọc được)'}
                  </div>
                </div>
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">GitHub Releases</div>
                  <div className="text-zinc-200">
                    {diagnostics.githubReleasesCount} release(s)
                    {diagnostics.githubLatestRelease && (
                      <span className="text-2xs text-zinc-500"> • Latest: <code className="text-violet-400">{diagnostics.githubLatestRelease.tag_name}</code> ({diagnostics.githubLatestRelease.assets} assets)</span>
                    )}
                  </div>
                </div>
                <div className="rounded border border-[#2b2d31] bg-[#131416] p-2">
                  <div className="text-2xs text-zinc-500 uppercase">Git Tags</div>
                  <div className="text-zinc-200">
                    {diagnostics.githubTagsCount} tag(s)
                    {diagnostics.githubTags.length > 0 && (
                      <span className="text-2xs text-zinc-500"> • {diagnostics.githubTags.slice(0, 3).map((t) => <code key={t} className="text-violet-400 mr-1">{t}</code>)}</span>
                    )}
                  </div>
                </div>
                {diagnostics.mainBranchCommit && (
                  <div className="col-span-2 rounded border border-[#2b2d31] bg-[#131416] p-2">
                    <div className="text-2xs text-zinc-500 uppercase">Commit mới nhất trên main</div>
                    <div className="text-zinc-200 font-mono text-2xs">
                      <code className="text-violet-400">{diagnostics.mainBranchCommit.sha}</code>
                      {' — '}
                      <span className="text-zinc-300">{diagnostics.mainBranchCommit.message}</span>
                      <span className="text-zinc-500"> ({new Date(diagnostics.mainBranchCommit.date).toLocaleString('vi-VN')})</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Diagnosis interpretation */}
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-2xs text-amber-200">
                <b>Phân tích:</b>{' '}
                {diagnostics.githubLatestRelease
                  ? <>Có Release mới nhất tag <code>{diagnostics.githubLatestRelease.tag_name}</code>. </>
                  : <>Không có GitHub Release nào. </>}
                {diagnostics.mainBranchVersion && diagnostics.mainBranchVersion !== diagnostics.clientVersion
                  ? <>Main branch có version <code>v{diagnostics.mainBranchVersion}</code> khác với app <code>v{diagnostics.clientVersion}</code>. </>
                  : <>Main branch version khớp với app. </>
                }
                {!diagnostics.githubLatestRelease && diagnostics.mainBranchVersion && (
                  <>Để app cũ nhận được update: tạo GitHub Release với tag <code>v{diagnostics.mainBranchVersion}</code> và upload file cài đặt (.zip/.exe/.dmg/.tar.gz).</>
                )}
              </div>

              {diagnostics.errors.length > 0 && (
                <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2 text-2xs text-rose-300">
                  <b>Lỗi:</b>
                  <ul className="list-disc ml-4 mt-1">
                    {diagnostics.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto-update policy */}
      <Card>
        <CardHeader>
          <CardTitle>Chính sách auto-update</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs text-zinc-400">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>Tự động kiểm tra cập nhật mỗi 6 giờ khi chạy desktop app</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{usePrivateRelease ? 'Check release private repo qua GitHub API và tải asset bằng token cục bộ' : 'Tải patch (BSDIFF, ~14KB) thay vì full bundle khi có thể'}</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>{usePrivateRelease ? 'Private repo hiện tải file cập nhật trực tiếp, chưa áp dụng patch nóng' : 'Hiển thị thông báo "Restart to update" khi sẵn sàng'}</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              <span>Không bao giờ tự cài đặt — user phải bấm "Cài đặt & khởi động lại"</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
              <span>Auto-update chỉ khả dụng trong desktop app (ElectroBun). Web mode chỉ kiểm tra version.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function platformLabel(p: string): string {
  const map: Record<string, string> = {
    macosArm64: 'macOS (Apple Silicon)',
    macosX64: 'macOS (Intel)',
    windowsX64: 'Windows x64',
    linuxX64: 'Linux x64',
  };
  return map[p] || p;
}

function AISettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();

  // Project policy: chỉ dùng Google Gemini làm provider duy nhất.
  // Provider luôn được ép về 'gemini' — không cho user đổi.
  const [form, setForm] = useState({
    defaultProvider: 'gemini' as const,
    defaultModel: resolveAIModel('gemini', settings?.defaultModel || AI_DEFAULT_MODELS.gemini),
    // Textarea content: 1 key per line (hoặc phân tách bằng dấu phẩy).
    // Trống khi user chưa nhập gì mới — server sẽ giữ nguyên keys đã lưu.
    geminiKeysText: '',
    groqApiKeyText: '',
    revidApiKeyText: '',
  });

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Cũng cho phép chỉnh sửa download path từ tab này cho tiện (vì 2 thứ hay
  // dùng cùng lúc). Tab Advanced vẫn có config đầy đủ.
  const [downloadPath, setDownloadPath] = useState('');
  useEffect(() => {
    if (settings?.downloadPath) setDownloadPath(settings.downloadPath);
  }, [settings?.downloadPath]);

  const handleSave = async () => {
    try {
      const patch: Record<string, unknown> = {
        defaultProvider: 'gemini',
        defaultModel: form.defaultModel,
      };

      // Parse textarea: tách theo newline hoặc dấu phẩy, trim, loại bỏ rỗng.
      const trimmed = form.geminiKeysText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (trimmed.length > 0) {
        patch.geminiApiKeys = trimmed;
      }
      if (form.groqApiKeyText.trim()) {
        patch.groqApiKey = form.groqApiKeyText.trim();
      }
      if (form.revidApiKeyText.trim()) {
        patch.revidApiKey = form.revidApiKeyText.trim();
      }
      if (downloadPath) {
        patch.downloadPath = downloadPath;
      }

      await updateMut.mutateAsync(patch);
      toast({
        title: 'Đã lưu settings',
        description: trimmed.length > 0
          ? `Đã cập nhật ${trimmed.length} Gemini API key`
          : 'Đã lưu settings',
        variant: 'success',
      });
      // Clear textarea sau khi save (server đã lưu keys mới)
      setForm((f) => ({ ...f, geminiKeysText: '', groqApiKeyText: '', revidApiKeyText: '' }));
    } catch (err) {
      toast({ title: 'Lỗi lưu', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const savedKeys: string[] = settings?.geminiApiKeys ?? [];
  const keysCount = settings?.geminiKeysCount ?? 0;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Provider mặc định</CardTitle>
          <Badge variant="violet" size="sm">Google Gemini</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3">
            <Field
              label="Default provider"
              hint="Project này chỉ dùng Google Gemini. Các provider khác (OpenAI, Claude, DeepSeek, OpenRouter, Qwen) đã bị tắt."
            >
              <Input value="Google Gemini" disabled />
            </Field>
            <Field label="Default model">
              <Input
                value={form.defaultModel}
                onChange={(e) => update('defaultModel', e.target.value)}
                placeholder={AI_DEFAULT_MODELS.gemini}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Gemini API Keys</CardTitle>
          <Badge variant="info" size="sm">
            <Key size={10} />
            {keysCount > 0 ? `${keysCount} key đã lưu` : 'Mã hóa tại local'}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Field
              label="Dán nhiều API key (mỗi key 1 dòng, hoặc cách nhau bằng dấu phẩy)"
              hint={
                keysCount > 0
                  ? `✓ Đã lưu ${keysCount} key. Để trống ô bên dưới để giữ nguyên. Dán lại để thay thế.`
                  : 'Lấy tại https://aistudio.google.com/apikey — hỗ trợ nhiều key để xoay vòng khi 1 key bị rate-limit.'
              }
            >
              <textarea
                className="w-full min-h-[120px] rounded-md border border-[#2b2d31] bg-[#131416] px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40 resize-y"
                value={form.geminiKeysText}
                onChange={(e) => update('geminiKeysText', e.target.value)}
                placeholder={'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\nAIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY\nAIzaSyZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>

            {keysCount > 0 && (
              <div className="rounded-md border border-[#2b2d31] bg-[#131416] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xs text-zinc-400 uppercase tracking-wide">
                    Đã cấu hình ({keysCount})
                  </div>
                  <div className="text-2xs text-zinc-500">
                    Hệ thống tự xoay vòng round-robin, park 60s khi 1 key lỗi 429/5xx
                  </div>
                </div>
                <div className="space-y-1">
                  {savedKeys.map((masked, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2 py-1 rounded bg-black/30 text-2xs font-mono text-zinc-300"
                    >
                      <span className="text-zinc-500 w-6 text-right">{idx + 1}.</span>
                      <span className="flex-1 truncate">{masked}</span>
                      <span className="text-emerald-400">✓</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field
              label="Groq Text-to-Speech API Key"
              hint={settings?.hasGroqKey ? '✓ Đã cấu hình Groq TTS. Để trống để giữ key hiện tại.' : 'Dùng riêng cho tab Tạo giọng nói; không ảnh hưởng provider dịch Gemini.'}
            >
              <Input
                type="password"
                value={form.groqApiKeyText}
                onChange={(e) => update('groqApiKeyText', e.target.value)}
                placeholder={settings?.hasGroqKey ? '••••••••' : 'gsk_...'}
                autoComplete="new-password"
                spellCheck={false}
              />
            </Field>

            <Field
              label="Revid API Key (Text-to-Speech)"
              hint={settings?.hasRevidKey ? '✓ Đã cấu hình Revid API. Lấy key tại revidapi.com' : 'Sử dụng Revid API (revidapi.com) để chuyển text thành giọng nói Việt chất lượng cao.'}
            >
              <Input
                type="password"
                value={form.revidApiKeyText}
                onChange={(e) => update('revidApiKeyText', e.target.value)}
                placeholder={settings?.hasRevidKey ? '••••••••' : 'Nhập Revid API key...'}
                autoComplete="new-password"
                spellCheck={false}
              />
            </Field>

            <Field
              label="Đường dẫn tải xuống mặc định"
              hint="Tự tạo folder nếu chưa có. Mặc định: ~/Downloads/SleizVietsubDownload"
            >
              <Input
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder="~/Downloads/SleizVietsubDownload"
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center justify-between p-3 rounded-md bg-[#131416] border border-[#2b2d31]">
            <div>
              <div className="text-xs text-zinc-300">Total tokens used</div>
              <div className="text-xl font-semibold text-violet-300">{formatTokens(settings?.totalTokensUsed || 0)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-300">Total cost</div>
              <div className="text-xl font-semibold text-rose-300">{formatCost(settings?.totalCostUsd || 0)}</div>
            </div>
          </div>

          <Button variant="primary" className="mt-4" onClick={handleSave} loading={updateMut.isPending}>
            <Save size={14} />
            Lưu Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TranslationSettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const [form, setForm] = useState({
    temperature: settings?.temperature ?? 0.3,
    maxRetries: settings?.maxRetries ?? 3,
    batchSize: settings?.batchSize ?? 100,
  });

  const handleSave = async () => {
    try {
      await updateMut.mutateAsync(form);
      toast({ title: 'Đã lưu', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translation Configuration</CardTitle>
        <Bot size={14} className="text-violet-400" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperature" hint="0 = deterministic, 1 = sáng tạo. Khuyến nghị 0.2-0.4 cho dịch thuật.">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={form.temperature}
              onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Xử lý batch" hint="Các batch phụ đề luôn được dịch lần lượt, không chạy song song.">
            <Input value="Tuần tự (1 batch mỗi lần)" readOnly />
          </Field>
          <Field label="Max retries" hint="Số lần thử lại khi AI lỗi">
            <Input
              type="number"
              min="0"
              max="10"
              value={form.maxRetries}
              onChange={(e) => setForm((f) => ({ ...f, maxRetries: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Batch size" hint="Số câu mỗi batch (mặc định 100)">
            <Input
              type="number"
              min="10"
              max="500"
              value={form.batchSize}
              onChange={(e) => setForm((f) => ({ ...f, batchSize: Number(e.target.value) }))}
            />
          </Field>
        </div>
        <Button variant="primary" className="mt-4" onClick={handleSave} loading={updateMut.isPending}>
          <Save size={14} />
          Lưu
        </Button>
      </CardContent>
    </Card>
  );
}

function BilibiliSettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const [cookie, setCookie] = useState('');

  const handleSave = async () => {
    try {
      if (!cookie) {
        toast({ title: 'Cookie trống', variant: 'warning' });
        return;
      }
      await updateMut.mutateAsync({ bilibiliCookie: cookie });
      toast({ title: 'Đã lưu cookie Bilibili', variant: 'success' });
      setCookie('');
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>Bilibili Cookie</CardTitle>
        <Cookie size={14} className="text-violet-400" />
      </CardHeader>
      <CardContent>
        <Field
          label="Cookie string"
          hint={
            settings?.hasBilibiliCookie
              ? '✓ Đã cấu hình (paste cookie mới để ghi đè)'
              : 'Mở bilibili.com → F12 → Application → Cookies → copy toàn bộ'
          }
        >
          <Textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="buvid3=...; SESSDATA=...; bili_jct=..."
            className="font-mono text-xs min-h-[120px]"
          />
        </Field>
        <Button variant="primary" className="mt-3" onClick={handleSave} loading={updateMut.isPending} disabled={!cookie}>
          <Save size={14} />
          Lưu cookie
        </Button>
        <div className="mt-4 p-3 rounded-md bg-blue-500/5 border border-blue-500/30 text-xs text-blue-200">
          <strong>Lưu ý:</strong> Cookie được lưu local và không bao giờ gửi đi ngoài Bilibili.
          Bạn nên rotate cookie định kỳ và không bao giờ chia sẻ cookie với ai.
        </div>
      </CardContent>
    </Card>
  );
}

function DownloadSettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const [downloadPath, setDownloadPath] = useState(settings?.downloadPath || '');
  const [downloadConcurrency, setDownloadConcurrency] = useState(settings?.downloadConcurrency || 3);
  const [showFileInput, setShowFileInput] = useState(false);

  // Detect if we're running inside ElectroBun desktop
  const isDesktop = typeof window !== 'undefined' && !!(window as Window).sleiz;

  const handleSelectFolder = async () => {
    if (isDesktop) {
      try {
        // Use the desktop file dialog API if available
        const result = await (window as any).sleiz?.selectFolder?.();
        if (result) {
          setDownloadPath(result);
        }
      } catch (err) {
        toast({
          title: 'Lỗi chọn thư mục',
          description: err instanceof Error ? err.message : '',
          variant: 'error',
        });
      }
    } else {
      // For web, just show the input field
      setShowFileInput(true);
    }
  };

  const handleSave = async () => {
    try {
      const finalPath = downloadPath || null;
      await updateMut.mutateAsync({ 
        downloadPath: finalPath,
        downloadConcurrency: downloadConcurrency,
      });
      toast({
        title: 'Đã lưu cấu hình tải phim',
        description: finalPath || 'Sử dụng mặc định ./data/storage',
        variant: 'success',
      });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const getDefaultPath = () => {
    if (typeof window !== 'undefined') {
      // On Windows, use Downloads folder
      const userHome = 'C:\\Users\\' + (navigator.userAgent.includes('Windows') ? 'Admin' : 'User');
      return userHome + '\\Downloads\\SleizVietsubDownload';
    }
    return './data/storage';
  };

  const currentPath = downloadPath || settings?.downloadPath || getDefaultPath();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Thư mục tải phim</CardTitle>
        <FolderOpen size={14} className="text-violet-400" />
      </CardHeader>
      <CardContent>
        <Field
          label="Đường dẫn lưu trữ"
          hint="Mặc định: Downloads/SleizVietsubDownload. Để trống để dùng mặc định ./data/storage"
        >
          <div className="flex gap-2">
            <Input
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              placeholder={getDefaultPath()}
              className="flex-1 font-mono text-xs"
            />
            {isDesktop && (
              <Button variant="secondary" size="sm" onClick={handleSelectFolder}>
                <Folder size={12} />
                Chọn thư mục
              </Button>
            )}
          </div>
        </Field>

        <Field
          label="Số lượng tải song song"
          hint="Tải bao nhiêu video cùng lúc (1-10). Khuyến nghị: 3-5"
          className="mt-3"
        >
          <Input
            type="number"
            min="1"
            max="10"
            value={downloadConcurrency}
            onChange={(e) => setDownloadConcurrency(Number(e.target.value))}
            className="w-32"
          />
        </Field>

        <div className="mt-3 p-3 rounded-md bg-[#131416] border border-[#2b2d31]">
          <div className="text-2xs text-zinc-500 uppercase mb-1">Đường dẫn hiện tại</div>
          <div className="text-sm text-zinc-200 font-mono break-all">{currentPath}</div>
          <div className="text-2xs text-zinc-500 mt-2">
            Video Bilibili: <span className="text-violet-400">{currentPath}/bilibili/videos/</span>
          </div>
          <div className="text-2xs text-zinc-500">
            Video TikTok: <span className="text-violet-400">{currentPath}/tiktok/videos/</span>
          </div>
          <div className="text-2xs text-zinc-500">
            Nhạc TikTok: <span className="text-violet-400">{currentPath}/tiktok/music/</span>
          </div>
        </div>

        <Button variant="primary" className="mt-3" onClick={handleSave} loading={updateMut.isPending}>
          <Save size={14} />
          Lưu cấu hình
        </Button>

        <div className="mt-4 p-3 rounded-md bg-blue-500/5 border border-blue-500/30 text-xs text-blue-200">
          <strong>Lưu ý:</strong> Thư mục sẽ được tự động tạo nếu chưa tồn tại. 
          Trong thư mục này sẽ có các thư mục con: bilibili/videos, tiktok/videos, tiktok/music.
          Tải song song giúp tăng tốc khi tải nhiều tập, nhưng không nên đặt quá cao để tránh bị chặn.
        </div>
      </CardContent>
    </Card>
  );
}

function UISettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const { toast } = useToast();
  const [theme, setTheme] = useState(settings?.theme || 'dark');
  const [language, setLanguage] = useState(settings?.language || 'vi');

  const handleSave = async () => {
    try {
      await updateMut.mutateAsync({ theme, language });
      toast({ title: 'Đã lưu', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>UI / Theme</CardTitle>
        <Palette size={14} className="text-violet-400" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Theme">
            <Select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}>
              <option value="dark">Dark (mặc định)</option>
              <option value="light">Light</option>
              <option value="system">Theo hệ thống</option>
            </Select>
          </Field>
          <Field label="Ngôn ngữ UI">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as 'vi' | 'en' | 'zh')}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </Select>
          </Field>
        </div>
        <Button variant="primary" className="mt-3" onClick={handleSave} loading={updateMut.isPending}>
          <Save size={14} />
          Lưu
        </Button>
      </CardContent>
    </Card>
  );
}

function AdvancedSettings() {
  const { data: settings } = useSettings();
  const updateMut = useUpdateSettings();
  const testMongoMut = useTestMongo();
  const { toast } = useToast();
  const [proxy, setProxy] = useState(settings?.proxy || '');
  const [mongodbUri, setMongodbUri] = useState('');
  const [githubPrivateRepo, setGithubPrivateRepo] = useState(
    settings?.githubPrivateRepo || 'tuanlinhsfh102-design/SleizUwU',
  );
  const [githubPrivateToken, setGithubPrivateToken] = useState('');
  const [updateAssetName, setUpdateAssetName] = useState(settings?.updateAssetName || 'win-x64');

  const handleSave = async () => {
    try {
      const patch: Record<string, unknown> = {
        proxy: proxy || null,
        githubPrivateRepo: githubPrivateRepo || null,
        updateAssetName: updateAssetName || null,
      };
      if (mongodbUri) patch.mongodbUri = mongodbUri;
      if (githubPrivateToken) patch.githubPrivateToken = githubPrivateToken;
      await updateMut.mutateAsync(patch);
      setMongodbUri('');
      setGithubPrivateToken('');
      toast({ title: 'Đã lưu', variant: 'success' });
    } catch (err) {
      toast({ title: 'Lỗi', description: err instanceof Error ? err.message : '', variant: 'error' });
    }
  };

  const handleTestMongo = async () => {
    try {
      await testMongoMut.mutateAsync();
      toast({ title: 'MongoDB OK', description: 'Kết nối thành công.', variant: 'success' });
    } catch (err) {
      toast({
        title: 'MongoDB lỗi',
        description: err instanceof Error ? err.message : 'Không kết nối được',
        variant: 'error',
      });
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Network Proxy</CardTitle>
          <Globe size={14} className="text-violet-400" />
        </CardHeader>
        <CardContent>
          <Field label="HTTP/HTTPS Proxy" hint="Dùng cho cả AI và tải media">
            <Input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://127.0.0.1:7890"
            />
          </Field>
          <Button variant="primary" className="mt-3" onClick={handleSave} loading={updateMut.isPending}>
            <Save size={14} />
            Lưu
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tích hợp MongoDB</CardTitle>
          <Database size={14} className="text-violet-400" />
        </CardHeader>
        <CardContent>
          <Field
            label="MongoDB URI"
            hint={settings?.hasMongoUri ? 'Đã cấu hình. Nhập URI mới nếu muốn ghi đè.' : 'Workspace phim sẽ được đồng bộ lên collection movie_workspaces'}
          >
            <Input
              type="password"
              value={mongodbUri}
              onChange={(e) => setMongodbUri(e.target.value)}
              placeholder={settings?.hasMongoUri ? '•••••••• (đã lưu)' : 'mongodb+srv://...'}
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleTestMongo} loading={testMongoMut.isPending}>
              Kiểm tra kết nối
            </Button>
            <Button variant="primary" onClick={handleSave} loading={updateMut.isPending}>
              <Save size={14} />
              Lưu
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Private Repo Update</CardTitle>
          <Download size={14} className="text-violet-400" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Field label="GitHub repo" hint="Dạng owner/repo. Ví dụ: tuanlinhsfh102-design/SleizUwU">
              <Input
                value={githubPrivateRepo}
                onChange={(e) => setGithubPrivateRepo(e.target.value)}
                placeholder="owner/repo"
              />
            </Field>
            <Field
              label="GitHub token"
              hint={settings?.hasGithubPrivateToken ? 'Đã cấu hình. Nhập token mới nếu muốn thay.' : 'Cần quyền đọc releases và assets của private repo'}
            >
              <Input
                type="password"
                value={githubPrivateToken}
                onChange={(e) => setGithubPrivateToken(e.target.value)}
                placeholder={settings?.hasGithubPrivateToken ? '•••••••• (đã lưu)' : 'ghp_...'}
              />
            </Field>
            <Field label="Từ khóa asset ưu tiên" hint="Tự động ưu tiên file có tên chứa chuỗi này khi bấm Tải bản mới">
              <Input
                value={updateAssetName}
                onChange={(e) => setUpdateAssetName(e.target.value)}
                placeholder="windows-x64 hoặc setup"
              />
            </Field>
            <Button variant="primary" onClick={handleSave} loading={updateMut.isPending}>
              <Save size={14} />
              Lưu tích hợp
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Database</CardTitle>
          <Database size={14} className="text-violet-400" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Engine</span>
              <span className="text-zinc-200">SQLite + WAL mode</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Cloud sync</span>
              <span className="text-zinc-200">{settings?.hasMongoUri ? 'MongoDB workspace sync' : 'Chưa bật'}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Private updates</span>
              <span className="text-zinc-200">
                {settings?.githubPrivateRepo && settings?.hasGithubPrivateToken
                  ? settings.githubPrivateRepo
                  : 'Chưa bật'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">ORM</span>
              <span className="text-zinc-200">Drizzle ORM</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Location</span>
              <span className="text-zinc-200 font-mono">./data/sleiz.db</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Realtime (Supabase Broadcast)
// ============================================================================
function RealtimeSettings() {
  const status = useRealtimeStatus();
  const eventsReceived = useRealtimeStore((s) => s.eventsReceived);
  const lastEventAt = useRealtimeStore((s) => s.lastEventAt);
  const lastError = useRealtimeStore((s) => s.lastError);
  const configured = isRealtimeConfigured();

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

  const statusMeta = {
    off: { label: 'Chưa cấu hình', color: 'text-zinc-400', icon: <WifiOff size={14} /> },
    connecting: { label: 'Đang kết nối…', color: 'text-amber-400', icon: <RefreshCw size={14} className="animate-spin" /> },
    connected: { label: 'Đã kết nối', color: 'text-emerald-400', icon: <Wifi size={14} /> },
    error: { label: 'Lỗi kết nối', color: 'text-rose-400', icon: <AlertTriangle size={14} /> },
  }[status];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Supabase Realtime</CardTitle>
          <Radio size={14} className="text-violet-400" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-xs">
            <p className="text-zinc-400 leading-relaxed">
              Supabase Realtime Broadcast đồng bộ mọi thay đổi dữ liệu (channels, movies,
              episodes, subtitles, batches, glossary, jobs, downloads, settings) đến tất cả
              client đang mở — thay thế polling 600ms–5s bằng push tức thời. Khi chưa cấu hình,
              app tiếp tục hoạt động bình thường qua polling.
            </p>

            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Trạng thái</span>
              <span className={`flex items-center gap-1.5 font-medium ${statusMeta.color}`}>
                {statusMeta.icon}
                {statusMeta.label}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Đã cấu hình (frontend)</span>
              <span className="text-zinc-200">
                {configured ? `Có — ${supabaseUrl.slice(0, 40)}…` : 'Chưa'}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
              <span className="text-zinc-400">Sự kiện đã nhận</span>
              <span className="text-zinc-200 font-mono">{eventsReceived.toLocaleString('vi-VN')}</span>
            </div>

            {lastEventAt && (
              <div className="flex items-center justify-between p-2.5 rounded-md bg-[#131416] border border-[#2b2d31]">
                <span className="text-zinc-400">Sự kiện gần nhất</span>
                <span className="text-zinc-200 font-mono">
                  {new Date(lastEventAt).toLocaleTimeString('vi-VN')}
                </span>
              </div>
            )}

            {lastError && status === 'error' && (
              <div className="p-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300">
                <span className="font-mono">{lastError}</span>
              </div>
            )}

            <div className="p-3 rounded-md bg-[#0f1115] border border-[#2b2d31]">
              <div className="text-zinc-300 font-medium mb-2">Cách bật Realtime</div>
              <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                <li>Tạo project miễn phí tại <span className="text-violet-300">supabase.com</span></li>
                <li>Vào Project Settings → API</li>
                <li>Copy <span className="font-mono text-zinc-200">Project URL</span> + <span className="font-mono text-zinc-200">publishable key</span> (sb_publishable_...) + <span className="font-mono text-zinc-200">secret key</span> (sb_secret_...)</li>
                <li>Thêm vào <span className="font-mono text-zinc-200">.env</span> ở root project:
                  <pre className="mt-1.5 p-2 rounded bg-black/40 text-[10px] font-mono text-zinc-300 overflow-x-auto">
{`SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx`}
                  </pre>
                </li>
                <li>Restart API server (<span className="font-mono text-zinc-200">bun dev:api</span>) và web (<span className="font-mono text-zinc-200">bun dev</span>) — hoặc dùng <span className="font-mono text-zinc-200">bun dev:all</span></li>
              </ol>
            </div>

            <div className="p-3 rounded-md bg-amber-500/5 border border-amber-500/20 text-amber-200/80">
              <strong className="text-amber-200">Lưu ý bảo mật:</strong> Secret key (sb_secret_...)
              chỉ dùng ở backend (API server). Frontend chỉ dùng publishable key (sb_publishable_...) —
              Supabase RLS phải cho phép broadcast trên channel <span className="font-mono">sleiz:realtime</span>
              (mặc định publishable key đã có quyền broadcast).
            </div>

            <div className="text-zinc-500 text-[10px]">
              Channel name: <span className="font-mono text-zinc-300">sleiz:realtime</span>
              {!supabaseKey && ' • chưa set VITE_SUPABASE_ANON_KEY'}
              {supabaseKey && (
                <> • anon key: <span className="font-mono text-zinc-300">{supabaseKey.slice(0, 12)}…</span></>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
