// Pure decisions behind the Vercel deployment lifecycle (`scripts/vercel-previews.mts`,
// `scripts/vercel-ignore-build.mts`): which pushes get a preview build, and which stored
// deployments can be deleted. Every retained deployment holds a full copy of the app's function
// bundles against the Hobby plan's Function Storage allowance — see `docs/vercel.md`.

/** The fields of a Vercel deployment record the planners read. */
export interface DeploymentSummary {
  uid: string;
  /** `'production'` for a production deployment; `null` for a preview. */
  target: string | null;
  /** Milliseconds since epoch. */
  created: number;
  state: string;
  /** Git branch the deployment was built from (`meta.githubCommitRef`); absent for a non-Git one. */
  branch?: string;
}

const IN_PROGRESS = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

/** The newest `count` READY deployments of `deployments`, plus any build still in progress. */
function newestReadyAndInProgress(deployments: DeploymentSummary[], count: number): DeploymentSummary[] {
  const ready = deployments
    .filter((d) => d.state === 'READY')
    .sort((a, b) => b.created - a.created)
    .slice(0, count);
  return [...ready, ...deployments.filter((d) => IN_PROGRESS.has(d.state))];
}

export interface PrunePlanInput {
  deployments: DeploymentSummary[];
  /** Head branches of the repo's open pull requests. */
  openPrBranches: ReadonlySet<string>;
  /** The deployment the production domain currently points at. Never deleted. */
  currentProductionId: string;
}

/**
 * The deployments to delete. Kept: the current production deployment, the newest two READY
 * production deployments (the Hobby plan can only roll back one step), and, for each branch with
 * an open pull request, its newest READY preview — plus any build still in progress. Everything
 * else goes: previews of merged, closed or never-PR'd branches, superseded previews, older
 * production deployments, and failed or canceled builds.
 */
export function planPrune({ deployments, openPrBranches, currentProductionId }: PrunePlanInput): DeploymentSummary[] {
  const keep = new Set([currentProductionId]);
  const production = deployments.filter((d) => d.target === 'production');
  for (const d of newestReadyAndInProgress(production, 2)) keep.add(d.uid);

  for (const branch of openPrBranches) {
    const previews = deployments.filter((d) => d.target !== 'production' && d.branch === branch);
    for (const d of newestReadyAndInProgress(previews, 1)) keep.add(d.uid);
  }
  return deployments.filter((d) => !keep.has(d.uid));
}

export interface BuildDecisionInput {
  /** `VERCEL_ENV`: `'production'`, `'preview'`, or `'development'`. */
  vercelEnv: string | undefined;
  /** `VERCEL_GIT_PULL_REQUEST_ID`: set when Vercel already ties the push to a PR. */
  pullRequestId: string | undefined;
  /** Whether GitHub reports an open PR for the branch, or `null` when the lookup failed. */
  branchHasOpenPr: boolean | null;
}

/**
 * Whether a Vercel Git build should run. Production always builds; a preview builds only for a
 * branch with an open pull request. An unknown PR state builds, so a GitHub outage or rate limit
 * costs storage (reclaimed by the daily prune) rather than a missing preview.
 */
export function shouldBuild({ vercelEnv, pullRequestId, branchHasOpenPr }: BuildDecisionInput): boolean {
  if (vercelEnv !== 'preview') return true;
  if (pullRequestId) return true;
  return branchHasOpenPr !== false;
}
