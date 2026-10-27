// Fetches a repo's issues, filters them, and prints a digest: each issue's metadata, its
// cross-references, and body signals (open questions, "done when" checklist, unverified claims,
// external blockers). Read-only.
//
//   npx tsx scripts/issue-digest.ts [--state open|closed|all] [--range <spec>] [--author <login>]
//     [--label <name>]... [--comments] [--format table|json] [--max-body <chars>] [--out <path>]
//     [--repo <owner/name>]
//
// --range     Comma-separated terms: `405`, `405-417`, `700-` (700 and above), `-50` (50 and below).
// --label     May repeat; an issue must carry every label given.
// --comments  Also read each selected issue's comments and report its latest triage assessment (a
//             comment opening with `<!-- triage-assessment body-sha=... -->`) as `fresh` when the
//             issue body is unchanged since, `stale` when it was edited.
// --max-body  Body characters kept per issue: default 20000 for `json`, 0 for `table`.
// --repo      Defaults to $GITHUB_REPOSITORY, then to the `origin` remote.
//
// Auth uses $GH_TOKEN or $GITHUB_TOKEN and falls back to unauthenticated requests (public repos,
// lower rate limit). Behind an HTTP proxy, run with NODE_USE_ENV_PROXY=1 so `fetch` honours
// HTTPS_PROXY.

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

const JSON_DEFAULT_MAX_BODY = 20000;

/** `value` takes one argument, `list` may repeat, `bool` takes none. */
const FLAGS = {
  state: 'value',
  range: 'value',
  author: 'value',
  label: 'list',
  comments: 'bool',
  format: 'value',
  'max-body': 'value',
  out: 'value',
  repo: 'value',
} as const;

type ParsedFlags = Map<string, string[]>;

/** Throws on an unknown flag, a missing argument, or a stray positional, so a typo can't quietly
 *  widen the selection. */
function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    const kind = name !== null && name in FLAGS ? FLAGS[name as keyof typeof FLAGS] : null;
    if (!name || !kind) throw new Error(`Unknown argument "${argv[i]}"`);
    if (kind === 'bool') {
      flags.set(name, []);
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    flags.set(name, [...(kind === 'list' ? (flags.get(name) ?? []) : []), value]);
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

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

/** Every page of a GitHub REST list endpoint (`path` carries any query string already). */
async function fetchAll<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com${path}${sep}per_page=100&page=${page}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}: ${await res.text()}`);
    const batch = (await res.json()) as T[];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const one = (name: string) => flags.get(name)?.[0];

  const state = one('state') ?? 'open';
  if (!['open', 'closed', 'all'].includes(state)) throw new Error('--state must be open, closed or all');
  const format = one('format') ?? 'table';
  if (!['table', 'json'].includes(format)) throw new Error('--format must be table or json');
  const maxBody = Number(one('max-body') ?? (format === 'json' ? JSON_DEFAULT_MAX_BODY : 0));
  if (!Number.isInteger(maxBody) || maxBody < 0) throw new Error('--max-body must be a non-negative integer');

  const range = one('range');
  const filter: IssueFilter = {
    ranges: range ? parseRanges(range) : undefined,
    author: one('author'),
    labels: flags.get('label'),
  };

  const repo = resolveRepo(one('repo'));
  const selected = (await fetchAll<RawIssue>(`/repos/${repo}/issues?state=${state}`))
    .filter((i) => matchesFilter(i, filter))
    .sort((a, b) => b.number - a.number);
  const issues = await Promise.all(
    selected.map(async (i) =>
      digestIssue(
        i,
        maxBody,
        flags.has('comments') ? await fetchAll<RawComment>(`/repos/${repo}/issues/${i.number}/comments`) : undefined,
      ),
    ),
  );

  const output = format === 'json' ? JSON.stringify(issues, null, 2) : renderTable(issues);
  const out = one('out');
  if (out) {
    writeFileSync(out, output + '\n');
    console.log(`Wrote ${issues.length} issue(s) from ${repo} to ${out}`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
