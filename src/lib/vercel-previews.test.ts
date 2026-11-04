import { describe, expect, it } from 'vitest';
import { planPrune, shouldBuild, type DeploymentSummary } from './vercel-previews';

const prod = (uid: string, created: number, state = 'READY'): DeploymentSummary => ({
  uid,
  target: 'production',
  created,
  state,
  branch: 'main',
});
const preview = (uid: string, branch: string | undefined, created: number, state = 'READY'): DeploymentSummary => ({
  uid,
  target: null,
  created,
  state,
  branch,
});
const removed = (input: Parameters<typeof planPrune>[0]) => planPrune(input).map((d) => d.uid).sort();

describe('planPrune', () => {
  it('keeps the current and previous production deployments and removes older ones', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), prod('p2', 2), prod('p3', 3), prod('p4', 4)],
        openPrBranches: new Set(),
        currentProductionId: 'p4',
      }),
    ).toEqual(['p1', 'p2']);
  });

  it('keeps a rolled-back current production deployment that is not among the newest', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), prod('p2', 2), prod('p3', 3)],
        openPrBranches: new Set(),
        currentProductionId: 'p1',
      }),
    ).toEqual([]);
  });

  it('counts only READY production deployments toward the two kept', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), prod('p2', 2), prod('p3', 3, 'ERROR')],
        openPrBranches: new Set(),
        currentProductionId: 'p2',
      }),
    ).toEqual(['p3']);
  });

  it("keeps an open PR's newest READY preview and in-progress builds, and removes the rest", () => {
    expect(
      removed({
        deployments: [
          prod('p1', 1),
          preview('old', 'feat/open', 2),
          preview('working', 'feat/open', 3),
          preview('failed-after', 'feat/open', 4, 'ERROR'),
          preview('building', 'feat/open', 5, 'BUILDING'),
        ],
        openPrBranches: new Set(['feat/open']),
        currentProductionId: 'p1',
      }),
    ).toEqual(['failed-after', 'old']);
  });

  it('removes previews of branches without an open PR and previews with no branch', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), preview('merged', 'feat/merged', 2), preview('canceled', 'wip', 3, 'CANCELED'), preview('cli', undefined, 4)],
        openPrBranches: new Set(),
        currentProductionId: 'p1',
      }),
    ).toEqual(['canceled', 'cli', 'merged']);
  });

  it('keeps a production build that is still in progress', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), prod('p2', 2), prod('p3', 3), prod('p4', 4, 'BUILDING')],
        openPrBranches: new Set(),
        currentProductionId: 'p3',
      }),
    ).toEqual(['p1']);
  });

  it('never keeps an old production deployment because main has an open PR', () => {
    expect(
      removed({
        deployments: [prod('p1', 1), prod('p2', 2), prod('p3', 3)],
        openPrBranches: new Set(['main']),
        currentProductionId: 'p3',
      }),
    ).toEqual(['p1']);
  });
});

describe('shouldBuild', () => {
  it('always builds production', () => {
    expect(shouldBuild({ vercelEnv: 'production', pullRequestId: '', branchHasOpenPr: false })).toBe(true);
  });

  it('builds a preview Vercel already ties to a PR', () => {
    expect(shouldBuild({ vercelEnv: 'preview', pullRequestId: '42', branchHasOpenPr: false })).toBe(true);
  });

  it('builds a preview whose branch has an open PR on GitHub', () => {
    expect(shouldBuild({ vercelEnv: 'preview', pullRequestId: '', branchHasOpenPr: true })).toBe(true);
  });

  it('skips a preview for a branch with no open PR', () => {
    expect(shouldBuild({ vercelEnv: 'preview', pullRequestId: '', branchHasOpenPr: false })).toBe(false);
  });

  it('builds when the PR lookup failed', () => {
    expect(shouldBuild({ vercelEnv: 'preview', pullRequestId: undefined, branchHasOpenPr: null })).toBe(true);
  });
});
