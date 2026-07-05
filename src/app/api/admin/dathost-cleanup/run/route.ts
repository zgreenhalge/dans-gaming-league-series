// Manually trigger dathost-cleanup for real (dry_run: false) from the admin server console,
// regardless of whether the workflow is currently disabled. GitHub's enable/disable toggle blocks
// workflow_dispatch along with the schedule, so a disabled workflow can't normally be dispatched at
// all — this captures the current state, enables it just long enough to dispatch, then restores
// whatever it was before, so "paused" still means paused afterward.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getWorkflow, setWorkflowEnabled, dispatchWorkflow } from '@/lib/gh-dispatch';
import { WORKFLOW_FILE } from '../status/route';

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const wf = await getWorkflow(WORKFLOW_FILE);
  const wasDisabled = wf.ok && wf.workflow.state !== 'active';

  if (wasDisabled) {
    const enabled = await setWorkflowEnabled(WORKFLOW_FILE, true);
    if (!enabled.ok) return NextResponse.json({ error: enabled.error }, { status: 502 });
  }

  try {
    const dispatch = await dispatchWorkflow(WORKFLOW_FILE, { dry_run: 'false' });
    if (!dispatch.ok) return NextResponse.json({ error: dispatch.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } finally {
    // Always put it back, whether dispatch succeeded or not — a disabled workflow should stay
    // disabled after a one-off manual run.
    if (wasDisabled) await setWorkflowEnabled(WORKFLOW_FILE, false);
  }
}
