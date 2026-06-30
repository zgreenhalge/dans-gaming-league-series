// Fire a GitHub Actions `workflow_dispatch` for a match-scoped job. Mirrors the inline call in
// `replay/dispatch`; shared so the demo-ingest dispatch (from the machine-auth notify route) doesn't
// duplicate it. Uses workflow_dispatch (needs Actions: write) — the workflow must exist on the
// dispatched ref's default branch to be triggerable.

export async function dispatchWorkflow(
  workflowFile: string,
  matchId: number,
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
        body: JSON.stringify({ ref, inputs: { match_id: String(matchId) } }),
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
