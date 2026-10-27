// Fetches a repo's issues, filters them, and prints a digest: each issue's metadata, its
// cross-references, and body signals (open questions, "done when" checklist, unverified claims,
// external blockers). Read-only.
//
//   npx tsx scripts/issue-digest.ts [--state open|closed|all] [--range <spec>] [--author <login>]
//     [--label <name>]... [--repo <owner/name>] [--format table|json] [--max-body <chars>]
//     [--out <path>] [--comments]
//
// `--comments` also reads each selected issue's comments and reports its latest triage assessment
// (a comment carrying a `<!-- triage-assessment body-sha=... -->` marker) as `fresh` when the issue
// body is unchanged since, `stale` when it was edited.
//
// `--max-body` limits how much of each body the digest carries: default 20000 for `json`, 0 for `table`.
//
// `--range` takes comma-separated terms: `405`, `405-417`, `700-` (700 and above), `-50` (50 and
// below). `--label` may repeat; an issue must carry every label given. `--repo` defaults to
// $GITHUB_REPOSITORY, then to the `origin` remote. Auth uses $GH_TOKEN or $GITHUB_TOKEN, and
// falls back to unauthenticated requests (public repos, lower rate limit). Behind an HTTP proxy,
// run with NODE_USE_ENV_PROXY=1 so `fetch` honours HTTPS_PROXY.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  digestIssue,
  matchesFilter,
  parseRanges,
  renderTable,
  type IssueFilter,
  type RawComment,
  type RawIssue,
} from './issue-digest-shared';

function parseFlags(argv: string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return flags;
}

function resolveRepo(flag: string | undefined): string {
  if (flag) return flag;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(remote);
  if (!m) throw new Error(`Cannot derive owner/name from origin remote "${remote}"; pass --repo.`);
  return m[1];
}

/** Every page of a GitHub REST list endpoint (`path` carries any query string already). */
async function fetchAll<T>(path: string): Promise<T[]> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const sep = path.includes('?') ? '&' : '?';
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com${path}${sep}per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`);
    const batch = (await res.json()) as T[];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const one = (k: string) => flags.get(k)?.[0];

  const state = one('state') ?? 'open';
  if (!['open', 'closed', 'all'].includes(state)) throw new Error(`--state must be open, closed or all`);
  const format = one('format') ?? 'table';
  if (!['table', 'json'].includes(format)) throw new Error(`--format must be table or json`);
  const maxBody = Number(one('max-body') ?? (format === 'json' ? 20000 : 0));
  if (!Number.isInteger(maxBody) || maxBody < 0) throw new Error(`--max-body must be a non-negative integer`);

  const filter: IssueFilter = {
    ranges: one('range') ? parseRanges(one('range')!) : undefined,
    author: one('author'),
    labels: flags.get('label'),
  };

  const repo = resolveRepo(one('repo'));
  const selected = (await fetchAll<RawIssue>(`/repos/${repo}/issues?state=${state}`))
    .filter((i) => matchesFilter(i, filter))
    .sort((a, b) => b.number - a.number);
  const issues = [];
  for (const i of selected) {
    const comments = flags.has('comments')
      ? await fetchAll<RawComment>(`/repos/${repo}/issues/${i.number}/comments`)
      : undefined;
    issues.push(digestIssue(i, maxBody, comments));
  }

  const output = format === 'json' ? JSON.stringify(issues, null, 2) : renderTable(issues);
  if (one('out')) {
    writeFileSync(one('out')!, output + '\n');
    console.log(`Wrote ${issues.length} issue(s) from ${repo} to ${one('out')}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
