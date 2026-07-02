// Fire a GitHub Actions `workflow_dispatch` with arbitrary inputs. Mirrors the inline call in
// `replay/dispatch`; shared so every dispatcher (demo-ingest by match, radar-build by map) sends the
// same request without duplicating it. Uses workflow_dispatch (needs Actions: write) — the workflow
// must exist on the dispatched ref's default branch to be triggerable. The caller owns the input
// shape (e.g. `{ match_id }` or `{ map_id }`) so this stays subject-agnostic.

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
