// Vercel's Ignored Build Step (`ignoreCommand` in vercel.json): decide whether a Git push builds.
// Production always builds; a preview builds only for a branch with an open pull request
// (`shouldBuild()` in `src/lib/vercel-previews.ts`). Exit 1 builds, exit 0 skips — so any crash
// here, including a Node too old to run TypeScript directly, builds rather than silently skipping.
//
// Runs before `npm install`, so it uses only Node built-ins (`node scripts/vercel-ignore-build.mts`
// relies on Node's built-in TypeScript type stripping).
//
// Env (set by Vercel): VERCEL_ENV, VERCEL_GIT_PULL_REQUEST_ID, VERCEL_GIT_COMMIT_REF,
// VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG.
import { shouldBuild } from '../src/lib/vercel-previews.ts';

async function branchHasOpenPr(): Promise<boolean | null> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const repo = process.env.VERCEL_GIT_REPO_SLUG;
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (!owner || !repo || !branch) return null;
  const url =
    `https://api.github.com/repos/${owner}/${repo}/pulls` +
    `?state=open&per_page=1&head=${encodeURIComponent(`${owner}:${branch}`)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dgls-vercel-ignore-build' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`GitHub PR lookup returned ${res.status}; treating PR state as unknown`);
      return null;
    }
    const prs = (await res.json()) as unknown[];
    return prs.length > 0;
  } catch (err) {
    console.log(`GitHub PR lookup failed (${String(err)}); treating PR state as unknown`);
    return null;
  }
}

const vercelEnv = process.env.VERCEL_ENV;
const pullRequestId = process.env.VERCEL_GIT_PULL_REQUEST_ID;
const openPr = vercelEnv === 'preview' && !pullRequestId ? await branchHasOpenPr() : null;
const build = shouldBuild({ vercelEnv, pullRequestId, branchHasOpenPr: openPr });

console.log(
  build
    ? `Building (${vercelEnv ?? 'unknown env'}, branch ${process.env.VERCEL_GIT_COMMIT_REF ?? '?'})`
    : `Skipping preview: branch ${process.env.VERCEL_GIT_COMMIT_REF} has no open pull request`,
);
process.exit(build ? 1 : 0);
