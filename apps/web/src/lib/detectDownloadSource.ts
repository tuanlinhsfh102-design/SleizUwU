/** Detect download source from a pasted URL / id. */
export type DownloadSource = 'bilibili' | 'tiktok' | 'unknown';

export function detectDownloadSource(input: string): DownloadSource {
  const raw = input.trim();
  if (!raw) return 'unknown';

  const lower = raw.toLowerCase();

  // TikTok first (more specific hostnames)
  if (
    lower.includes('tiktok.com') ||
    lower.includes('vm.tiktok.com') ||
    lower.includes('vt.tiktok.com') ||
    lower.includes('douyin.com')
  ) {
    return 'tiktok';
  }

  // Bilibili hosts / short links
  if (
    lower.includes('bilibili.com') ||
    lower.includes('b23.tv') ||
    lower.includes('bili2233.cn') ||
    lower.includes('acg.tv')
  ) {
    return 'bilibili';
  }

  // Bare Bilibili ids: BV1..., av123, ep123, ss123
  if (/^(BV[\w]+|av\d+|ep\d+|ss\d+)$/i.test(raw)) {
    return 'bilibili';
  }

  // Bare numeric id alone is ambiguous — leave unknown
  return 'unknown';
}

/** Extract bare http(s) URLs out of arbitrary pasted text (captions, chat messages, etc). */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return matches.map((m) => m.replace(/[),.;!?'"]+$/g, ''));
}

export function sourceLabel(source: DownloadSource): string {
  switch (source) {
    case 'bilibili':
      return 'Bilibili';
    case 'tiktok':
      return 'TikTok';
    default:
      return 'Không nhận diện';
  }
}
