// Status for the admin server console's disk-cleanup controls: whether the dathost-cleanup
// workflow is enabled, its most recent run, and the currently configured interval (a repo Actions
// variable — see scripts/dathost-cleanup.ts and the workflow file for how it's used).

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getWorkflow, getLatestRun, getRepoVariable, type LatestRun } from '@/lib/gh-dispatch';

export const WORKFLOW_FILE = 'dathost-cleanup.yml';
export const INTERVAL_VARIABLE = 'DATHOST_CLEANUP_INTERVAL_DAYS';
const DEFAULT_INTERVAL_DAYS = 1;

export interface DathostCleanupStatus {
  enabled: boolean | null;
  lastRun: LatestRun | null;
  intervalDays: number;
  error: string | null;
  // Reading the interval needs the token's "Variables" permission (distinct from "Actions") — kept
  // separate from `error` so a missing scope only degrades the interval control, not the whole panel.
  intervalError: string | null;
}

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const [wf, run, variable] = await Promise.all([
    getWorkflow(WORKFLOW_FILE),
    getLatestRun(WORKFLOW_FILE),
    getRepoVariable(INTERVAL_VARIABLE),
  ]);

  const firstError = [wf, run].find((r) => !r.ok) as { error: string } | undefined;

  return NextResponse.json({
    enabled: wf.ok ? wf.workflow.state === 'active' : null,
    lastRun: run.ok ? run.run : null,
    intervalDays: variable.ok && variable.value ? Number(variable.value) : DEFAULT_INTERVAL_DAYS,
    error: firstError?.error ?? null,
    intervalError: variable.ok ? null : variable.error,
  } satisfies DathostCleanupStatus);
}
