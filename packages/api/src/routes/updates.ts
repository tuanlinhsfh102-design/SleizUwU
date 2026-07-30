import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { APP_VERSION } from '@sleiz/shared';
import { schema, type DB } from '@sleiz/database';
import type { Env } from '../index.js';

export const updatesRouter = new Hono<Env>();

const GITHUB_REPO = 'tuanlinhsfh102-design/SleizUwU';
const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

const PUBLIC_RELEASE = {
  version: APP_VERSION,
  channel: 'stable',
  releasedAt: new Date().toISOString(),
  notes: 'Latest release of Sleiz Studio.',
  downloads: {
    macosArm64: `${GITHUB_RELEASE_BASE}/stable-macos-arm64-SleizStudio.dmg`,
    macosX64: `${GITHUB_RELEASE_BASE}/stable-macos-x64-SleizStudio.dmg`,
    windowsX64: `${GITHUB_RELEASE_BASE}/stable-win-x64-SleizStudio-Setup.zip`,
    linuxX64: `${GITHUB_RELEASE_BASE}/stable-linux-x64-SleizStudioSetup.tar.gz`,
  },
  minRequired: '0.1.0',
};

updatesRouter.get('/manifest', async (c) => {
  const release = await getConfiguredRelease(c);
  return c.json({ data: release });
});

updatesRouter.get('/check', async (c) => {
  const clientVersion = c.req.query('v') || APP_VERSION;
  const release = await getConfiguredRelease(c);
  const latestVersion = release.version;

  return c.json({
    data: {
      updateAvailable: compareVersions(latestVersion, clientVersion) > 0,
      required: compareVersions(release.minRequired || '0.0.0', clientVersion) > 0,
      current: clientVersion,
      latest: latestVersion,
      channel: release.channel,
      notes: release.notes,
      releasedAt: release.releasedAt,
      downloads: release.downloads,
      // Diagnostics: surface WHY there's (no) update so the UI can explain it.
      source: release.source || 'public',
      repo: release.repo || GITHUB_REPO,
      hasRelease: Boolean(release.hasRelease),
      hasAssets: Boolean(release.downloads && Object.keys(release.downloads).length > 0),
    },
  });
});

/**
 * Diagnostics endpoint — exposes everything the check endpoint learned
 * from GitHub so the Settings UI can show why "no update" was returned.
 * Useful when the user is confused about why their old app claims it's
 * already on the latest version.
 */
updatesRouter.get('/diagnostics', async (c) => {
  const db = c.get('db') as DB;
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const repo = settings?.githubPrivateRepo || process.env.GITHUB_PRIVATE_REPO || '';
  const token = settings?.githubPrivateToken || process.env.GITHUB_PRIVATE_TOKEN || '';
  const usePrivate = Boolean(repo && token);

  const diag = {
    clientVersion: APP_VERSION,
    localTime: new Date().toISOString(),
    privateRepoConfigured: usePrivate,
    repo: repo || GITHUB_REPO,
    githubLatestRelease: null as null | { tag_name: string; published_at: string; assets: number; prerelease: boolean },
    githubReleasesCount: 0,
    githubTagsCount: 0,
    githubTags: [] as string[],
    mainBranchVersion: null as null | string,
    mainBranchCommit: null as null | { sha: string; date: string; message: string },
    errors: [] as string[],
  };

  const headers = token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sleiz-Studio-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      }
    : {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sleiz-Studio-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      };

  const effectiveRepo = repo || GITHUB_REPO;

  // /releases/latest
  try {
    const r = await fetch(`https://api.github.com/repos/${effectiveRepo}/releases/latest`, { headers });
    if (r.ok) {
      const j = (await r.json()) as { tag_name?: string; published_at?: string; prerelease?: boolean; assets?: unknown[] };
      diag.githubLatestRelease = {
        tag_name: j.tag_name || '',
        published_at: j.published_at || '',
        assets: (j.assets || []).length,
        prerelease: Boolean(j.prerelease),
      };
    }
  } catch (err) {
    diag.errors.push(`releases/latest: ${err instanceof Error ? err.message : String(err)}`);
  }

  // /releases count
  try {
    const r = await fetch(`https://api.github.com/repos/${effectiveRepo}/releases?per_page=10`, { headers });
    if (r.ok) {
      const arr = (await r.json()) as unknown[];
      diag.githubReleasesCount = Array.isArray(arr) ? arr.length : 0;
    }
  } catch (err) {
    diag.errors.push(`releases: ${err instanceof Error ? err.message : String(err)}`);
  }

  // /tags
  try {
    const r = await fetch(`https://api.github.com/repos/${effectiveRepo}/tags?per_page=10`, { headers });
    if (r.ok) {
      const arr = (await r.json()) as Array<{ name?: string }>;
      diag.githubTagsCount = Array.isArray(arr) ? arr.length : 0;
      diag.githubTags = (arr || []).map((t) => t.name || '').filter(Boolean);
    }
  } catch (err) {
    diag.errors.push(`tags: ${err instanceof Error ? err.message : String(err)}`);
  }

  // /contents/package.json?ref=main — read version field from the repo's main branch
  try {
    const r = await fetch(
      `https://api.github.com/repos/${effectiveRepo}/contents/package.json?ref=main`,
      { headers },
    );
    if (r.ok) {
      const j = (await r.json()) as { content?: string; encoding?: string };
      if (j.content && j.encoding === 'base64') {
        const text = Buffer.from(j.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(text) as { version?: string };
        diag.mainBranchVersion = pkg.version || null;
      }
    }
  } catch (err) {
    diag.errors.push(`contents/package.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  // /commits/main — latest commit info
  try {
    const r = await fetch(`https://api.github.com/repos/${effectiveRepo}/commits/main`, { headers });
    if (r.ok) {
      const j = (await r.json()) as { sha?: string; commit?: { author?: { date?: string }; message?: string } };
      diag.mainBranchCommit = {
        sha: (j.sha || '').slice(0, 7),
        date: j.commit?.author?.date || '',
        message: (j.commit?.message || '').split('\n')[0].slice(0, 120),
      };
    }
  } catch (err) {
    diag.errors.push(`commits/main: ${err instanceof Error ? err.message : String(err)}`);
  }

  return c.json({ data: diag });
});

updatesRouter.get('/download', async (c) => {
  const db = c.get('db') as DB;
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const repo = settings?.githubPrivateRepo || process.env.GITHUB_PRIVATE_REPO || '';
  const token = settings?.githubPrivateToken || process.env.GITHUB_PRIVATE_TOKEN || '';
  const assetId = c.req.query('assetId');
  const assetName = c.req.query('name') || 'update.bin';

  if (!repo || !token || !assetId) {
    return c.json({ error: 'ValidationError', message: 'Missing private repo update configuration' }, 400);
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'Sleiz-Studio-Updater',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });

  if (!res.ok || !res.body) {
    return c.json({ error: 'GitHubDownloadError', message: `GitHub responded with ${res.status}` }, 502);
  }

  c.header('Content-Type', res.headers.get('content-type') || 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${assetName.replace(/"/g, '')}"`);
  return c.body(res.body);
});

async function getConfiguredRelease(c: { get: (key: 'db') => DB }) {
  const db = c.get('db') as DB;
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  const repo = settings?.githubPrivateRepo || process.env.GITHUB_PRIVATE_REPO || GITHUB_REPO;
  const token = settings?.githubPrivateToken || process.env.GITHUB_PRIVATE_TOKEN || '';

  const headers = token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sleiz-Studio-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      }
    : {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sleiz-Studio-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      };

  // 1. Try /releases/latest (preferred — has actual downloadable assets)
  const latestRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (latestRes.ok) {
    const rel = mapGithubRelease(repo, await latestRes.json());
    return { ...rel, source: 'github-release' as const, repo, hasRelease: true };
  }

  // 2. Try /releases?per_page=5 (any release, not just "latest")
  const listRes = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=5`, { headers });
  if (listRes.ok) {
    const releases = (await listRes.json()) as Array<Record<string, unknown>>;
    if (Array.isArray(releases) && releases.length > 0) {
      const rel = mapGithubRelease(repo, releases[0] as Parameters<typeof mapGithubRelease>[1]);
      return { ...rel, source: 'github-release' as const, repo, hasRelease: true };
    }
  }

  // 3. Fallback: read package.json from the repo's main branch and use its
  //    `version` field. This lets old apps detect that the repo's main
  //    branch has a newer version even when no GitHub Release has been
  //    created yet. The download button won't work in this case, but at
  //    least the user is told "there IS a newer version, please create a
  //    Release to download it".
  let mainBranchVersion: string | null = null;
  let mainCommitSha: string | null = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/package.json?ref=main`, { headers });
    if (r.ok) {
      const j = (await r.json()) as { content?: string; encoding?: string };
      if (j.content && j.encoding === 'base64') {
        const text = Buffer.from(j.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(text) as { version?: string };
        mainBranchVersion = pkg.version || null;
      }
    }
  } catch {
    // ignore
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers });
    if (r.ok) {
      const j = (await r.json()) as { sha?: string };
      mainCommitSha = (j.sha || '').slice(0, 7);
    }
  } catch {
    // ignore
  }

  if (mainBranchVersion) {
    const isOlder = compareVersions(mainBranchVersion, APP_VERSION) < 0;
    return {
      version: mainBranchVersion,
      channel: 'stable',
      releasedAt: new Date().toISOString(),
      notes:
        `Phiên bản ${mainBranchVersion} trên nhánh main của ${repo}` +
        (mainCommitSha ? ` (commit ${mainCommitSha})` : '') +
        (isOlder
          ? `. Đây là phiên bản CŨ hơn phiên bản app hiện tại (${APP_VERSION}). Có thể bạn đang dùng bản build mới hơn repo.`
          : `. Để tải bản này, cần tạo GitHub Release với tag v${mainBranchVersion} và upload file cài đặt (.zip/.exe/.dmg). Hiện tại chưa có Release nào trên repo.`),
      downloads: {},
      minRequired: '0.1.0',
      source: 'main-branch-package-json' as const,
      repo,
      hasRelease: false,
    };
  }

  // 4. Try /tags?per_page=5 — last resort, no asset downloads possible
  const tagsRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=5`, { headers });
  if (tagsRes.ok) {
    const tags = (await tagsRes.json()) as Array<{ name?: string }>;
    if (Array.isArray(tags) && tags[0]?.name) {
      return {
        version: normalizeVersion(tags[0].name),
        channel: 'stable',
        releasedAt: new Date().toISOString(),
        notes: `Repo ${repo} có tag ${tags[0].name} nhưng chưa có Release assets. Hãy tạo GitHub Release và upload file cài đặt để tải bản mới.`,
        downloads: {},
        minRequired: '0.1.0',
        source: 'github-tag' as const,
        repo,
        hasRelease: false,
      };
    }
  }

  // 5. Total fallback — return public release with a clear note
  return {
    ...PUBLIC_RELEASE,
    notes: `Repo ${repo} chưa có Release, tag, hoặc file package.json ở nhánh main. Để cập nhật: bump version trong package.json, push lên main, rồi tạo GitHub Release với tag (vd v${APP_VERSION}) và upload file cài đặt (.zip/.exe/.dmg/.tar.gz).`,
    downloads: {},
    source: 'public-fallback' as const,
    repo,
    hasRelease: false,
  };
}

function mapGithubRelease(
  repo: string,
  release: {
    tag_name?: string;
    body?: string;
    published_at?: string;
    prerelease?: boolean;
    assets?: Array<{ id: number; name: string }>;
  },
) {
  const downloads = Object.fromEntries(
    (release.assets || []).map((asset) => [
      asset.name,
      `/api/updates/download?assetId=${asset.id}&name=${encodeURIComponent(asset.name)}`,
    ]),
  );

  return {
    version: normalizeVersion(release.tag_name || APP_VERSION),
    channel: release.prerelease ? 'canary' : 'stable',
    releasedAt: release.published_at || new Date().toISOString(),
    notes: release.body || `Latest release from ${repo}`,
    downloads,
    minRequired: '0.1.0',
  };
}

function normalizeVersion(value: string): string {
  return value.replace(/^v/i, '');
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
