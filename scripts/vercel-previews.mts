// Manage the Vercel project's stored deployments over the Vercel REST API. Every deployment Vercel
// keeps holds a full copy of the app's function bundles against the Hobby plan's Function Storage
// allowance (`docs/vercel.md`), so previews live only as long as their pull request.
//
//   node scripts/vercel-previews.mts deploy <branch> <sha>   # build a preview for a commit, unless one exists
//   node scripts/vercel-previews.mts cleanup <branch>        # delete every preview built from a branch
//   node scripts/vercel-previews.mts prune                   # delete everything planPrune() returns
//
// DRY_RUN=true lists what `cleanup`/`prune` would delete without deleting anything. Deleted
// deployments stay restorable from the Vercel dashboard for its recovery period. Uses only Node
// built-ins and Node's TypeScript type stripping, so it needs no `npm install`.
//
// Env: VERCEL_TOKEN (the script logs a notice and exits cleanly without it), VERCEL_TEAM_ID,
// VERCEL_PROJECT (name or id), VERCEL_PRODUCTION_HOST (the production domain), GITHUB_REPOSITORY
// (`owner/repo`); for `prune` also GITHUB_TOKEN.
import { planPrune, type DeploymentSummary } from '../src/lib/vercel-previews.ts';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function vercel<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.vercel.com${path}${sep}teamId=${env('VERCEL_TEAM_ID')}`, {
    method,
    headers: { Authorization: `Bearer ${env('VERCEL_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Vercel ${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface ApiDeployment {
  uid: string;
  target?: string | null;
  created: number;
  state?: string;
  readyState?: string;
  meta?: { githubCommitRef?: string; githubCommitSha?: string };
}

type Deployment = DeploymentSummary & { sha?: string };

/** Every deployment of the project, following pagination; `query` adds filters (`&sha=…`). */
async function listDeployments(query = ''): Promise<Deployment[]> {
  const out: Deployment[] = [];
  let until = '';
  for (;;) {
    const page = await vercel<{ deployments: ApiDeployment[]; pagination?: { next?: number | null } }>(
      'GET',
      `/v6/deployments?projectId=${encodeURIComponent(env('VERCEL_PROJECT'))}&limit=100${query}${until}`,
    );
    for (const d of page.deployments) {
      out.push({
        uid: d.uid,
        target: d.target ?? null,
        created: d.created,
        state: d.state ?? d.readyState ?? 'UNKNOWN',
        branch: d.meta?.githubCommitRef,
        sha: d.meta?.githubCommitSha,
      });
    }
    if (!page.pagination?.next) return out;
    until = `&until=${page.pagination.next}`;
  }
}

async function openPrBranches(): Promise<Set<string>> {
  const branches = new Set<string>();
  for (let page = 1; ; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${env('GITHUB_REPOSITORY')}/pulls?state=open&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${env('GITHUB_TOKEN')}`, Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) throw new Error(`GitHub list PRs → ${res.status}: ${await res.text()}`);
    const prs = (await res.json()) as { head: { ref: string } }[];
    for (const pr of prs) branches.add(pr.head.ref);
    if (prs.length < 100) return branches;
  }
}

async function remove(deployments: DeploymentSummary[]): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  for (const d of deployments) {
    const label = `${d.uid} (${d.target ?? 'preview'}, ${d.state}, ${d.branch ?? 'no branch'}, ${new Date(d.created).toISOString()})`;
    if (!dryRun) await vercel('DELETE', `/v13/deployments/${d.uid}`);
    console.log(`${dryRun ? 'would delete' : 'deleted'} ${label}`);
  }
  console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deployments.length} deployment(s)`);
}

async function deploy(branch: string, sha: string): Promise<void> {
  // A push the Ignored Build Step skipped leaves a CANCELED deployment for the same commit, so only
  // a live or in-progress one counts as already deployed.
  const existing = (await listDeployments(`&sha=${sha}`)).find(
    (d) => d.sha === sha && d.state !== 'CANCELED' && d.state !== 'ERROR',
  );
  if (existing) {
    console.log(`Deployment ${existing.uid} already covers ${sha}; nothing to do`);
    return;
  }
  const [org, repo] = env('GITHUB_REPOSITORY').split('/');
  const created = await vercel<{ id: string; url: string }>('POST', '/v13/deployments', {
    name: env('VERCEL_PROJECT'),
    project: env('VERCEL_PROJECT'),
    gitSource: { type: 'github', org, repo, ref: branch, sha },
  });
  console.log(`Created preview ${created.id} for ${branch}@${sha}: https://${created.url}`);
}

async function prune(): Promise<void> {
  const [deployments, branches, production] = await Promise.all([
    listDeployments(),
    openPrBranches(),
    // Looking a deployment up by the production domain returns the one it currently points at.
    vercel<{ id: string }>('GET', `/v13/deployments/${env('VERCEL_PRODUCTION_HOST')}`),
  ]);
  await remove(planPrune({ deployments, openPrBranches: branches, currentProductionId: production.id }));
}

async function main(): Promise<void> {
  if (!process.env.VERCEL_TOKEN) {
    console.log('::notice::VERCEL_TOKEN is not set; skipping');
    return;
  }
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'deploy' && args.length === 2) return deploy(args[0], args[1]);
  if (mode === 'cleanup' && args.length === 1) {
    const branch = args[0];
    return remove((await listDeployments()).filter((d) => d.target !== 'production' && d.branch === branch));
  }
  if (mode === 'prune' && args.length === 0) return prune();
  throw new Error('usage: vercel-previews.mts deploy <branch> <sha> | cleanup <branch> | prune');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
