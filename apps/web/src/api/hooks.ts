/**
 * TanStack Query hooks for all API endpoints.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { API_PATHS } from '@sleiz/shared';
import type {
  Channel,
  Movie,
  Episode,
  Subtitle,
  Batch,
  GlossaryEntry,
  Character,
  HistoryEntry,
  Job,
  AppSettings,
  BilibiliVideoInfo,
  DownloadProgress,
} from '@sleiz/shared';

// ----- Channels -----
export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ data: Channel[] }>(API_PATHS.channels).then((r) => r.data),
  });
}
export function useChannel(id: string | null) {
  return useQuery({
    queryKey: ['channel', id],
    queryFn: () => api.get<{ data: Channel }>(API_PATHS.channel(id!)).then((r) => r.data),
    enabled: !!id,
  });
}
export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Channel>) => api.post<{ data: Channel }>(API_PATHS.channels, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}
export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Channel> & { id: string }) =>
      api.patch<{ data: Channel }>(API_PATHS.channel(id), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}
export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API_PATHS.channel(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

// ----- Movies -----
export function useMovies(channelId?: string, q?: string) {
  const params = new URLSearchParams();
  if (channelId) params.set('channelId', channelId);
  if (q) params.set('q', q);
  const qs = params.toString();
  return useQuery({
    queryKey: ['movies', channelId, q],
    queryFn: () =>
      api.get<{ data: Movie[] }>(`${API_PATHS.movies}${qs ? `?${qs}` : ''}`).then((r) => r.data),
  });
}
export function useMovie(id: string | null) {
  return useQuery({
    queryKey: ['movie', id],
    queryFn: () => api.get<{ data: Movie }>(API_PATHS.movie(id!)).then((r) => r.data),
    enabled: !!id,
  });
}
export function useMovieWorkspace(id: string | null) {
  return useQuery({
    queryKey: ['movie-workspace', id],
    queryFn: () => api.get<{ data: unknown }>(API_PATHS.movieWorkspace(id!)).then((r) => r.data),
    enabled: !!id,
    // When Supabase Realtime is connected, broadcast events will invalidate
    // this query instantly. The 8s polling is a fallback for offline mode.
    refetchInterval: 8000,
  });
}
export function useEnsureMovieWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (movieId: string) => api.post<{ data: unknown }>(API_PATHS.movieWorkspace(movieId)),
    onSuccess: (_result, movieId) => {
      qc.invalidateQueries({ queryKey: ['movie-workspace', movieId] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
    },
  });
}
export function useCreateMovie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Movie>) => api.post<{ data: Movie }>(API_PATHS.movies, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies'] }),
  });
}
export function useUpdateMovie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Movie> & { id: string }) =>
      api.patch<{ data: Movie }>(API_PATHS.movie(id), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies'] }),
  });
}
export function useDeleteMovie() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API_PATHS.movie(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies'] }),
  });
}

// ----- Episodes -----
export function useEpisodes(movieId?: string) {
  const qs = movieId ? `?movieId=${movieId}` : '';
  return useQuery({
    queryKey: ['episodes', movieId],
    queryFn: () => api.get<{ data: Episode[] }>(`${API_PATHS.episodes}${qs}`).then((r) => r.data),
  });
}
export function useEpisode(id: string | null) {
  return useQuery({
    queryKey: ['episode', id],
    queryFn: () => api.get<{ data: Episode }>(API_PATHS.episode(id!)).then((r) => r.data),
    enabled: !!id,
  });
}
export function useCreateEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Episode>) => api.post<{ data: Episode }>(API_PATHS.episodes, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episodes'] }),
  });
}
export function useUpdateEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Episode> & { id: string }) =>
      api.patch<{ data: Episode }>(API_PATHS.episode(id), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episodes'] }),
  });
}
export function useDeleteEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API_PATHS.episode(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episodes'] }),
  });
}

// ----- Movie translation media -----
export interface RenderVideoResult {
  videoUrl: string;
  subtitleUrl: string;
  voiceUrl: string;
  audioMode: 'replace' | 'duck';
  model: string;
  voice: string;
}
export function useUploadMovieVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ episodeId, file }: { episodeId: string; file: File }) => {
      const form = new FormData();
      form.append('episodeId', episodeId);
      form.append('file', file);
      return api.postForm<{ data: { url: string; fileName: string; size: number } }>(API_PATHS.mediaVideo, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episodes'] }),
  });
}
export function useStartVideoRender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { episodeId: string; subtitleId: string; audioMode: 'replace' | 'duck'; model: string; voice: string }) =>
      api.post<{ data: { id: string; status: string } }>(API_PATHS.mediaRender, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
export function useJob(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => api.get<{ data: Job }>(API_PATHS.job(id!)).then((r) => r.data),
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' || status === 'cancelled' ? false : 1500;
    },
  });
}
export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(API_PATHS.job(id) + '/cancel'),
    onSuccess: (_result, id) => qc.invalidateQueries({ queryKey: ['job', id] }),
  });
}

// ----- Subtitles -----
export function useSubtitles(episodeId?: string) {
  const qs = episodeId ? `?episodeId=${episodeId}` : '';
  return useQuery({
    queryKey: ['subtitles', episodeId],
    queryFn: () => api.get<{ data: Subtitle[] }>(`${API_PATHS.subtitles}${qs}`).then((r) => r.data),
  });
}
export function useSubtitle(id: string | null) {
  return useQuery({
    queryKey: ['subtitle', id],
    queryFn: () => api.get<{ data: Subtitle }>(API_PATHS.subtitle(id!)).then((r) => r.data),
    enabled: !!id,
  });
}
export function useImportSubtitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { episodeId: string; content: string; filename: string; language?: string }) =>
      api.post<{ data: { id: string; format: string; cueCount: number } }>(`${API_PATHS.subtitles}/import`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subtitles'] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
      qc.removeQueries({ queryKey: ['batches'] });
    },
  });
}
export function useUpdateSubtitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Subtitle> & { id: string }) =>
      api.patch<{ data: Subtitle }>(API_PATHS.subtitle(id), input),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['subtitle', r.data.id] });
      qc.invalidateQueries({ queryKey: ['subtitles'] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
    },
  });
}
export function useUpdateCue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subtitleId, cueId, ...patch }: { subtitleId: string; cueId: string } & Record<string, unknown>) =>
      api.patch(`${API_PATHS.subtitle(subtitleId)}/cues/${cueId}`, patch),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['subtitle', vars.subtitleId] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
    },
  });
}
export function useTranslateSubtitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { subtitleId: string; provider?: string; model?: string; channelId?: string; movieId?: string; batchSize?: number }) =>
      api.post<{ data: unknown }>(API_PATHS.subtitleTranslate(input.subtitleId), input),
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useStartTranslateSubtitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { subtitleId: string; provider?: string; model?: string; channelId?: string; movieId?: string; batchSize?: number }) =>
      api.post<{ data: { subtitleId: string; running: boolean } }>(API_PATHS.subtitleTranslateStart(input.subtitleId), input),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['subtitle', vars.subtitleId] });
    },
  });
}
export function useResetSubtitleTranslation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subtitleId: string) =>
      api.post<{ data: { subtitleId: string; clearedCues: number } }>(API_PATHS.subtitleTranslationReset(subtitleId)),
    onSuccess: (_r, subtitleId) => {
      qc.invalidateQueries({ queryKey: ['subtitle', subtitleId] });
      qc.invalidateQueries({ queryKey: ['subtitle-translate-status', subtitleId] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
    },
  });
}
export function useTranslateSubtitleStatus(subtitleId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['subtitle-translate-status', subtitleId],
    queryFn: () => api.get<{ data: { running: boolean; done: boolean; totalBatches: number; completedBatches: number; failedBatches: number; episodeStatus: string } }>(API_PATHS.subtitleTranslateStatus(subtitleId!)).then((r) => r.data),
    enabled: !!subtitleId && enabled,
    // Realtime broadcasts drive this now; 4s is just a fallback.
    refetchInterval: 4000,
  });
}
export function useDeleteSubtitle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API_PATHS.subtitle(id)),
    onSuccess: (_result, subtitleId) => {
      qc.removeQueries({ queryKey: ['subtitle', subtitleId] });
      qc.removeQueries({ queryKey: ['subtitle-translate-status', subtitleId] });
      qc.removeQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['subtitles'] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
    },
  });
}

// ----- Batches -----
export function useBatches(opts?: { episodeId?: string; subtitleId?: string }) {
  const params = new URLSearchParams();
  if (opts?.episodeId) params.set('episodeId', opts.episodeId);
  if (opts?.subtitleId) params.set('subtitleId', opts.subtitleId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['batches', opts?.episodeId, opts?.subtitleId],
    queryFn: () => api.get<{ data: Batch[] }>(`${API_PATHS.batches}${qs ? `?${qs}` : ''}`).then((r) => r.data),
  });
}

// ----- Glossary -----
export function useGlossary(opts?: { channelId?: string; movieId?: string }) {
  const params = new URLSearchParams();
  if (opts?.channelId) params.set('channelId', opts.channelId);
  if (opts?.movieId) params.set('movieId', opts.movieId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['glossary', opts],
    queryFn: () => api.get<{ data: GlossaryEntry[] }>(`${API_PATHS.glossary}${qs ? `?${qs}` : ''}`).then((r) => r.data),
  });
}
export function useCreateGlossaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<GlossaryEntry>) => api.post<{ data: GlossaryEntry }>(API_PATHS.glossary, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });
}
export function useBulkCreateGlossary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: Partial<GlossaryEntry>[]) =>
      api.post<{ data: GlossaryEntry[]; count: number }>(`${API_PATHS.glossary}/bulk`, { entries }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });
}
export function useUpdateGlossaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<GlossaryEntry> & { id: string }) =>
      api.patch<{ data: GlossaryEntry }>(API_PATHS.glossaryEntry(id), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });
}
export function useDeleteGlossaryEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(API_PATHS.glossaryEntry(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['glossary'] }),
  });
}

// ----- Characters -----
export function useCharacters(movieId?: string) {
  const qs = movieId ? `?movieId=${movieId}` : '';
  return useQuery({
    queryKey: ['characters', movieId],
    queryFn: () => api.get<{ data: Character[] }>(`${API_PATHS.characters}${qs}`).then((r) => r.data),
  });
}
export function useCreateCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Character>) => api.post<{ data: Character }>(API_PATHS.characters, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters'] }),
  });
}
export function useDeleteCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${API_PATHS.characters}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters'] }),
  });
}

// ----- AI -----
export function useAIProviders() {
  return useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => api.get<{ data: Array<{ id: string; label: string; defaultModel: string }> }>(API_PATHS.aiProviders).then((r) => r.data),
  });
}
export function useAITranslate() {
  return useMutation({
    mutationFn: (input: { text: string; provider?: string; model?: string; channelId?: string; movieId?: string }) =>
      api.post<{
        data: { source: string; target: string; fromMemory: boolean; usage: unknown; provider: string; model: string };
      }>(API_PATHS.aiTranslate, input),
  });
}
export interface GroqSpeechResult {
  audioUrl: string;
  fileName: string;
  bytes: number;
  model: string;
  voice: string;
}
export function useAISpeech() {
  return useMutation({
    mutationFn: (input: { text: string; model?: string; voice?: string }) =>
      api.post<{ data: GroqSpeechResult }>(API_PATHS.aiSpeech, input),
  });
}
export interface MovieTitleSuggestion {
  titleVi: string;
  titleZh: string;
  titleEn: string;
  aliases: string[];
  confidence: number;
  reason: string;
  provider: string;
  model: string;
  usage: unknown;
}
export function useSuggestMovieTitle() {
  return useMutation({
    mutationFn: (input: { content: string; filename?: string; currentTitle?: string }) =>
      api.post<{ data: MovieTitleSuggestion }>(API_PATHS.aiMovieTitle, input),
  });
}
export function useAIDescription() {
  return useMutation({
    mutationFn: (input: { episodeId: string }) => api.post(API_PATHS.aiDescription, input),
  });
}
export function useAIDescriptionByEpisode(episodeId: string | null) {
  return useQuery({
    queryKey: ['ai-description', episodeId],
    queryFn: () => api.get<{ data: unknown }>(API_PATHS.aiDescriptionByEpisode(episodeId!)).then((r) => r.data),
    enabled: !!episodeId,
  });
}
export function useAIThumbnail() {
  return useMutation({
    mutationFn: (input: { episodeId: string }) => api.post(API_PATHS.aiThumbnail, input),
  });
}
export function useAIConsistency() {
  return useMutation({
    mutationFn: (input: { subtitleId: string }) => api.post(API_PATHS.aiConsistency, input),
  });
}
export function useAISubtitleRewrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { subtitleId: string; instruction: string }) => api.post<{ data: { subtitleId: string } }>(API_PATHS.aiSubtitleRewrite, input),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ['subtitle', vars.subtitleId] });
      qc.invalidateQueries({ queryKey: ['movie-workspace'] });
    },
  });
}

// ----- Bilibili -----
export function useBilibiliParse() {
  return useMutation({
    mutationFn: (input: { url: string }) => api.post<{ data: BilibiliVideoInfo }>(API_PATHS.bilibiliParse, input),
  });
}
export function useBilibiliSubtitles() {
  return useMutation({
    mutationFn: (input: { aid: number; cid: number }) =>
      api.get<{ data: unknown }>(`${API_PATHS.bilibiliSubtitles}?aid=${input.aid}&cid=${input.cid}`),
  });
}
export function useBilibiliDownloadSubtitle() {
  return useMutation({
    mutationFn: (input: { subtitleUrl: string }) =>
      api.post<{ data: { format: string; content: string } }>(API_PATHS.bilibiliDownload, input),
  });
}
export function useBilibiliDownloadVideo() {
  return useMutation({
    mutationFn: (input: { url?: string; bvid?: string; filename?: string; jobId?: string }) =>
      api.post<{
        data: {
          filePath: string;
          fileSize: number;
          durationMs: number;
          source: string;
          mimeType: string;
          jobId: string;
        };
      }>(API_PATHS.bilibiliDownloadVideo, input),
  });
}

// ----- TikTok -----
export interface TiktokVideoInfo {
  id: string;
  url: string;
  author: string;
  authorId: string;
  authorAvatar?: string;
  title: string;
  description: string;
  cover: string;
  dynamicCover?: string;
  originCover?: string;
  duration: number;
  playUrl: string;
  playUrlNoWatermark?: string;
  downloadUrl?: string;
  musicUrl?: string;
  musicTitle?: string;
  musicAuthor?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  downloadCount?: number;
  createdAt?: number;
  region?: string;
}

export function useTiktokParse() {
  return useMutation({
    mutationFn: (input: { url: string }) =>
      api.post<{ data: TiktokVideoInfo }>(API_PATHS.tiktokParse, input),
  });
}
export function useTiktokDownload() {
  return useMutation({
    mutationFn: (input: { url: string; filename?: string; music?: boolean; jobId?: string }) =>
      api.post<{
        data: {
          filePath: string;
          fileSize: number;
          durationMs: number;
          source: string;
          mimeType: string;
          jobId: string;
          info: { id: string; title: string; author: string; duration: number; cover?: string };
        };
      }>(API_PATHS.tiktokDownload, input),
  });
}

/**
 * Poll the in-memory progress broker for a download job. Returns `null` once
 * the server reports the job is missing (either GC'd or never existed), so the
 * caller can stop polling.
 */
export function useDownloadStatus(
  jobId: string | null | undefined,
  enabled = true,
  refetchMs = 2000,
) {
  return useQuery<DownloadProgress | null>({
    queryKey: ['download-status', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      try {
        const r = await api.get<{ data: DownloadProgress | null }>(API_PATHS.downloadStatus(jobId));
        return r.data ?? null;
      } catch (err) {
        // 404 → job was GC'd or never existed; signal "no data" without throwing
        // so the UI can stop polling gracefully.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('HTTP 404')) return null;
        throw err;
      }
    },
    enabled: !!jobId && enabled,
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ----- Export -----
export function useExportSubtitle() {
  return useMutation({
    mutationFn: (input: { subtitleId: string; format: 'srt' | 'vtt' | 'ass' | 'txt' | 'json'; preferTranslated?: boolean; translatedOnly?: boolean }) =>
      api.post<{
        data: { content: string; filename: string; mimeType: string; format: string; cueCount: number };
      }>(API_PATHS.exportSubtitle, input),
  });
}

// ----- History -----
export function useHistory(opts?: { action?: string; entityType?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (opts?.action) params.set('action', opts.action);
  if (opts?.entityType) params.set('entityType', opts.entityType);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['history', opts],
    queryFn: () => api.get<{ data: HistoryEntry[] }>(`${API_PATHS.history}${qs ? `?${qs}` : ''}`).then((r) => r.data),
  });
}
export function useClearHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(API_PATHS.history),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['history'] }),
  });
}

// ----- Jobs -----
export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get<{ data: Job[] }>(API_PATHS.jobs).then((r) => r.data),
    // Realtime broadcasts drive this now; 15s is just a fallback.
    refetchInterval: 15000,
  });
}

// ----- Statistics -----
export function useStatistics() {
  return useQuery({
    queryKey: ['statistics'],
    queryFn: () => api.get<{ data: unknown }>(API_PATHS.statistics).then((r) => r.data),
    // Realtime broadcasts drive this now; 60s is just a fallback.
    refetchInterval: 60_000,
  });
}

// ----- Updates -----
export interface UpdateCheckResult {
  updateAvailable: boolean;
  required: boolean;
  current: string;
  latest: string;
  channel: string;
  notes: string;
  releasedAt: string;
  downloads: Record<string, string>;
  // Diagnostics — explain WHY there's (no) update
  source?: 'github-release' | 'main-branch-package-json' | 'github-tag' | 'public-fallback' | 'public' | 'native';
  repo?: string;
  hasRelease?: boolean;
  hasAssets?: boolean;
}

export interface UpdateDiagnostics {
  clientVersion: string;
  localTime: string;
  privateRepoConfigured: boolean;
  repo: string;
  githubLatestRelease: null | { tag_name: string; published_at: string; assets: number; prerelease: boolean };
  githubReleasesCount: number;
  githubTagsCount: number;
  githubTags: string[];
  mainBranchVersion: null | string;
  mainBranchCommit: null | { sha: string; date: string; message: string };
  errors: string[];
}

/**
 * Check for updates. When running inside ElectroBun desktop, prefers the
 * native Updater via window.sleiz (more accurate, includes patch info).
 * Falls back to the /api/updates/check endpoint for web/dev mode.
 */
export function useCheckForUpdate(opts?: { preferApi?: boolean; currentVersion?: string }) {
  return useMutation({
    mutationFn: async (): Promise<UpdateCheckResult> => {
      // Native desktop path (typed via apps/web/src/types/native.d.ts)
      const nativeApi = (typeof window !== 'undefined' ? (window as Window).sleiz : undefined);
      if (nativeApi?.update && !opts?.preferApi) {
        try {
          const local = await nativeApi.update.getLocalInfo();
          const remote = await nativeApi.update.check();
          return {
            updateAvailable: remote.updateAvailable,
            required: false,
            current: local.version,
            latest: remote.version,
            channel: local.channel,
            notes: remote.error || 'Update available.',
            releasedAt: new Date().toISOString(),
            downloads: {},
          };
        } catch (err) {
          console.warn('[update] native check failed, falling back to API:', err);
        }
      }
      // Web / dev fallback
      const current = opts?.currentVersion || '0.2.0';
      const r = await api.get<{ data: UpdateCheckResult }>(`${API_PATHS.updatesCheck}?v=${current}`);
      return r.data;
    },
  });
}

export function useDownloadUpdate() {
  return useMutation({
    mutationFn: async (): Promise<{ ok: boolean; error?: string }> => {
      const nativeApi = (typeof window !== 'undefined' ? (window as Window).sleiz : undefined);
      if (nativeApi?.update) {
        return await nativeApi.update.download();
      }
      return { ok: false, error: 'Native update only available in desktop app' };
    },
  });
}

export function useApplyUpdate() {
  return useMutation({
    mutationFn: async (): Promise<{ ok: boolean; error?: string }> => {
      const nativeApi = (typeof window !== 'undefined' ? (window as Window).sleiz : undefined);
      if (nativeApi?.update) {
        return await nativeApi.update.apply();
      }
      return { ok: false, error: 'Native update only available in desktop app' };
    },
  });
}

export function useUpdateDiagnostics() {
  return useMutation({
    mutationFn: async (): Promise<UpdateDiagnostics> => {
      const r = await api.get<{ data: UpdateDiagnostics }>(API_PATHS.updatesDiagnostics);
      return r.data;
    },
  });
}

// ----- Settings -----
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ data: AppSettings | null }>(API_PATHS.settings).then((r) => r.data),
  });
}
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AppSettings> & Record<string, unknown>) => api.patch(API_PATHS.settings, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useTestMongo() {
  return useMutation({
    mutationFn: () => api.post<{ data: { ok: boolean } }>('/api/settings/test-mongo'),
  });
}

export function useRenderVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      episodeId: string;
      subtitleId: string;
      audioMode?: 'replace' | 'duck';
      ttsEngine?: 'edge' | 'google' | 'groq';
      voice?: string;
      watermarkText?: string;
      bgVolume?: number;
    }) => api.post<{ data: { id: string; status: string } }>('/api/media/render', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

// ============================================================================
// Video Translate — automated pipeline (upload → STT → translate → TTS → render)
// ============================================================================

export interface VideoTranslateJob {
  id: string;
  movieId: string | null;
  episodeId: string | null;
  originalVideoPath: string;
  extractedAudioPath: string | null;
  originalSrtPath: string | null;
  translatedSrtPath: string | null;
  ttsAudioPath: string | null;
  outputVideoPath: string | null;
  thumbnailPath: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string | null;
  totalSteps: number;
  error: string | null;
  settings: {
    voice: string;
    logoPath?: string;
    cropTo16x9: boolean;
    blurIntensity: number;
    logoPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    logoScale: number;
    ttsSpeed?: number;
    ttsVolume?: number;
    originalAudioMode?: 'replace' | 'mix';
    originalAudioVolume?: number;
  };
  metadata: Record<string, unknown>;
  originalVideoUrl: string | null;
  outputVideoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface VideoTranslateJobStatus {
  id: string;
  status: string;
  progress: number;
  currentStep: string | null;
  totalSteps: number;
  isProcessing: boolean;
  error: string | null;
  outputVideoPath: string | null;
  outputVideoUrl: string | null;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
}

export interface VideoMetadataInfo {
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string;
  audioCodec?: string;
  bitrate: number;
  aspectRatio: string;
  isAlready16x9: boolean;
}

/** Probe video metadata (dimensions, fps, duration) for preview overlays. */
export function useProbeVideo(videoPath: string | null) {
  return useQuery({
    queryKey: ['video-translate-probe', videoPath],
    queryFn: () =>
      api.post<{ ok: boolean; data: VideoMetadataInfo }>(API_PATHS.videoTranslateProbe, { videoPath: videoPath }).then((r) => r.data),
    enabled: !!videoPath,
    staleTime: Infinity, // video dimensions don't change after upload
  });
}

export function useVideoTranslateJobs() {
  return useQuery({
    queryKey: ['video-translate-jobs'],
    queryFn: () => api.get<{ data: VideoTranslateJob[] }>(API_PATHS.videoTranslate).then((r) => r.data),
    refetchInterval: false,
  });
}

export function useVideoTranslateJob(id: string | null, poll = false) {
  return useQuery({
    queryKey: ['video-translate-job', id],
    queryFn: () => api.get<{ data: VideoTranslateJob }>(API_PATHS.videoTranslateJob(id!)).then((r) => r.data),
    enabled: !!id,
    refetchInterval: poll ? 1500 : false,
  });
}

export function useVideoTranslateJobStatus(id: string | null, poll = false) {
  return useQuery({
    queryKey: ['video-translate-job-status', id],
    queryFn: () => api.get<{ data: VideoTranslateJobStatus }>(API_PATHS.videoTranslateJobStatus(id!)).then((r) => r.data),
    enabled: !!id,
    // When poll=true, refetch every 1.2s but stop as soon as the job
    // reaches a terminal state (completed / failed).
    refetchInterval: poll
      ? (query) => {
          const s = query.state.data?.status;
          if (s === 'completed' || s === 'failed') return false;
          return 1200;
        }
      : false,
  });
}

export function useUploadVideoTranslateVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.postForm<{ ok: boolean; data: { url: string; absolutePath: string; fileName: string; storedName: string; size: number } }>(
        API_PATHS.videoTranslateUploadVideo,
        fd,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}

export function useUploadVideoTranslateLogo() {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.postForm<{ ok: boolean; data: { url: string; absolutePath: string; fileName: string; storedName: string; size: number } }>(
        API_PATHS.videoTranslateUploadLogo,
        fd,
      );
    },
  });
}

export interface CreateVideoTranslateJobInput {
  videoPath: string;
  movieId?: string;
  episodeId?: string;
  voice?: string;
  logoPath?: string;
  cropTo16x9?: boolean;
  blurIntensity?: number;
  logoPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  logoScale?: number;
  // Audio controls
  ttsSpeed?: number;              // 0.5–2.0
  ttsVolume?: number;             // 0.0–3.0
  originalAudioMode?: 'replace' | 'mix';
  originalAudioVolume?: number;   // 0.0–1.0
}

export function useCreateVideoTranslateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVideoTranslateJobInput) =>
      api.post<{ data: { id: string; status: string } }>(API_PATHS.videoTranslate, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}

export function useStartVideoTranslateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ data: { id: string; running: boolean } }>(API_PATHS.videoTranslateJobStart(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}

export function useCancelVideoTranslateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ data: { id: string; cancelled: boolean } }>(API_PATHS.videoTranslateJobCancel(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}

export function useRetryVideoTranslateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ data: { id: string; status: string } }>(API_PATHS.videoTranslateJobRetry(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}

export function useDeleteVideoTranslateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(API_PATHS.videoTranslateJob(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['video-translate-jobs'] }),
  });
}
