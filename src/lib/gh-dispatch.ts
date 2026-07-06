// Fire a GitHub Actions `workflow_dispatch` with arbitrary inputs, and a handful of sibling
// operations (enable/disable a workflow, read its latest run, read/write a repo Actions variable)
// used by the admin server console's cleanup controls. All share the same
// GITHUB_DISPATCH_TOKEN/GITHUB_REPO auth as dispatchWorkflow. Reading/writing repo Variables needs
// that token to additionally have the "Variables" repository permission (a fine-grained PAT scope
// distinct from "Actions") — Actions: write alone (what dispatch/enable/disable/runs need) doesn't
// cover it.

async function ghApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; text: string; json: unknown }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo) {
    return { status: 0, ok: false, text: 'GITHUB_DISPATCH_TOKEN / GITHUB_REPO not set', json: null };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, ok: res.ok, text, json };
}

export interface WorkflowState {
  state: string; // 'active' | 'disabled_manually' | 'disabled_inactivity' | ...
}

/** Current enabled/disabled state of a workflow file. */
export async function getWorkflow(
  workflowFile: string,
): Promise<{ ok: true; workflow: WorkflowState } | { ok: false; error: string }> {
  const res = await ghApi('GET', `/actions/workflows/${workflowFile}`);
  if (!res.ok) return { ok: false, error: `GitHub GET workflow ${res.status}: ${res.text.slice(0, 200)}` };
  return { ok: true, workflow: res.json as WorkflowState };
}

/** Enable or disable a workflow's triggers (schedule AND workflow_dispatch together — GitHub
 *  doesn't expose a way to split them). */
export async function setWorkflowEnabled(workflowFile: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const res = await ghApi('PUT', `/actions/workflows/${workflowFile}/${enabled ? 'enable' : 'disable'}`);
  if (!res.ok) return { ok: false, error: `GitHub ${enabled ? 'enable' : 'disable'} ${res.status}: ${res.text.slice(0, 200)}` };
  return { ok: true };
}

export interface LatestRun {
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null (while not completed)
  createdAt: string;
  htmlUrl: string;
  event: string; // 'schedule' | 'workflow_dispatch' | ...
}

/** The single most recent run of a workflow (any status), or `null` if it's never run. */
export async function getLatestRun(
  workflowFile: string,
): Promise<{ ok: true; run: LatestRun | null } | { ok: false; error: string }> {
  const res = await ghApi('GET', `/actions/workflows/${workflowFile}/runs?per_page=1`);
  if (!res.ok) return { ok: false, error: `GitHub GET runs ${res.status}: ${res.text.slice(0, 200)}` };
  const run = (res.json as { workflow_runs?: Array<Record<string, unknown>> })?.workflow_runs?.[0];
  if (!run) return { ok: true, run: null };
  return {
    ok: true,
    run: {
      status: String(run.status),
      conclusion: (run.conclusion as string | null) ?? null,
      createdAt: String(run.created_at),
      htmlUrl: String(run.html_url),
      event: String(run.event),
    },
  };
}

/** Read a repository Actions variable, or `null` if it doesn't exist yet. */
export async function getRepoVariable(name: string): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  const res = await ghApi('GET', `/actions/variables/${name}`);
  if (res.status === 404) return { ok: true, value: null };
  if (!res.ok) return { ok: false, error: `GitHub GET variable ${res.status}: ${res.text.slice(0, 200)}` };
  return { ok: true, value: String((res.json as { value?: string })?.value ?? '') };
}

/** Create or update a repository Actions variable (PATCH to update; falls back to POST-create on
 *  a 404, since the API has no upsert). */
export async function setRepoVariable(name: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const patch = await ghApi('PATCH', `/actions/variables/${name}`, { name, value });
  if (patch.ok) return { ok: true };
  if (patch.status !== 404) return { ok: false, error: `GitHub PATCH variable ${patch.status}: ${patch.text.slice(0, 200)}` };
  const create = await ghApi('POST', `/actions/variables`, { name, value });
  if (!create.ok) return { ok: false, error: `GitHub POST variable ${create.status}: ${create.text.slice(0, 200)}` };
  return { ok: true };
}

export async function dispatchWorkflow(
  workflowFile: string,
  inputs: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo) {
    return { ok: false, error: 'GITHUB_DISPATCH_TOKEN / GITHUB_REPO not set' };
  }
  const ref = process.env.GITHUB_DISPATCH_REF || 'main';
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref, inputs }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `GitHub dispatch ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
