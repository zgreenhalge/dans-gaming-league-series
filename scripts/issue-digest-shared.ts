// Pure helpers for scripts/issue-digest.ts: issue-number selection, conventional-commit title
// parsing, prior-assessment lookup, and the body signals the digest reports. No I/O, so they are
// unit-tested directly.

import { createHash } from 'node:crypto';

export interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  html_url: string;
  /** Present on pull requests, which the issues endpoint also returns. */
  pull_request?: unknown;
}

export interface RawComment {
  html_url: string;
  created_at: string;
  body: string | null;
}

/** A triage assessment comment found on an issue. `fresh` means the issue body is unchanged since
 *  the comment was written, so its findings still describe the issue. */
export interface TriageNote {
  url: string;
  postedAt: string;
  fresh: boolean;
}

export interface IssueDigest {
  number: number;
  title: string;
  url: string;
  author: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  /** Conventional-commit type and scope of the title (`perf(db): ...`), when it has one. */
  type: string | null;
  scope: string | null;
  bodyChars: number;
  /** Short hash of the body. A triage comment records it so a later run can tell whether the body changed. */
  bodySha: string;
  /** The latest triage assessment comment, or null if none; undefined when comments weren't fetched. */
  triage?: TriageNote | null;
  /** Other issue/PR numbers the title or body mentions, ascending. */
  refs: number[];
  signals: BodySignals;
  /** The body, trimmed to `--max-body` characters (0 omits it). */
  body: string;
}

/** Facts read off the body by pattern. They are hints for the person triaging, not verdicts. */
export interface BodySignals {
  /** The body has a `Done when` / acceptance checklist. */
  hasDoneWhen: boolean;
  /** Count of phrases that leave a choice open (`decide`, `open question`, `whether`, ...). */
  openQuestions: number;
  /** The body says its claim is unverified or unmeasured. */
  unverified: boolean;
  /** The body names something outside the code that gates it (a live match, a dashboard, data). */
  externalBlocker: boolean;
  /** The body says it replaces, supersedes or is split out of other work. */
  supersedes: boolean;
}

/** One inclusive span of issue numbers; `max` is `Infinity` for an open-ended `N-`. */
export interface NumberRange {
  min: number;
  max: number;
}

/**
 * Parses a comma-separated selection into inclusive ranges: `405`, `405-417`, `700-` (700 and
 * above), `-50` (50 and below), e.g. `"12,405-417,700-"`. Throws on anything else so a typo
 * doesn't silently select everything.
 */
export function parseRanges(spec: string): NumberRange[] {
  return spec.split(',').map((raw) => {
    const term = raw.trim();
    const m = /^(\d*)(-?)(\d*)$/.exec(term);
    if (!term || !m || (!m[1] && !m[3])) throw new Error(`Invalid issue range "${term}"`);
    const [, lo, dash, hi] = m;
    if (!dash) return { min: Number(lo), max: Number(lo) };
    const range = { min: lo ? Number(lo) : 0, max: hi ? Number(hi) : Infinity };
    if (range.min > range.max) throw new Error(`Invalid issue range "${term}": start is above end`);
    return range;
  });
}

export function inRanges(n: number, ranges: NumberRange[]): boolean {
  return ranges.some((r) => n >= r.min && n <= r.max);
}

/** Splits `type(scope)!: subject` titles; anything else has no type or scope. */
export function parseTitle(title: string): { type: string | null; scope: string | null } {
  const m = /^([a-z]+)(?:\(([^)]*)\))?!?:\s/.exec(title);
  return m ? { type: m[1], scope: m[2] ?? null } : { type: null, scope: null };
}

/** `#123` and `…/issues/123` / `…/pull/123` mentions, deduplicated and ascending. */
export function findRefs(text: string, self: number): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/(?:#|\/(?:issues|pull)\/)(\d{1,6})\b/g)) found.add(Number(m[1]));
  found.delete(self);
  return [...found].sort((a, b) => a - b);
}

const OPEN_QUESTION = /\b(decide|decision|open questions?|whether|should we|to be determined|tbd)\b/gi;
const UNVERIFIED = /\b(unverified|not (?:yet )?(?:measured|reproduced|verified)|none of these were reproduced)\b/i;
const EXTERNAL_BLOCKER =
  /\b(live match|dashboard|next season|local supabase stack|seeded .* fixture|real data|deployed page)\b/i;
const SUPERSEDES = /\b(replaces|superseded|supersedes|split out of|split from)\b/i;

export function bodySignals(body: string): BodySignals {
  return {
    hasDoneWhen: /^#{1,6}\s*(done when|acceptance)/im.test(body),
    openQuestions: body.match(OPEN_QUESTION)?.length ?? 0,
    unverified: UNVERIFIED.test(body),
    externalBlocker: EXTERNAL_BLOCKER.test(body),
    supersedes: SUPERSEDES.test(body),
  };
}

/** Opens a triage assessment comment and records the body it assessed:
 *  `<!-- triage-assessment body-sha=<bodySha> -->`. It must start the comment, so a reply that
 *  quotes an assessment (`> <!-- ... -->`) isn't mistaken for one. */
const TRIAGE_MARKER = /^\s*<!--\s*triage-assessment\s+body-sha=([0-9a-f]+)\s*-->/;

export function bodySha(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

/** The most recent triage comment (comments arrive oldest first), compared against the current body. */
export function findTriageNote(comments: RawComment[], currentSha: string): TriageNote | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const m = TRIAGE_MARKER.exec(comments[i].body ?? '');
    if (m) return { url: comments[i].html_url, postedAt: comments[i].created_at, fresh: m[1] === currentSha };
  }
  return null;
}

const labelNames = (issue: RawIssue) => issue.labels.map((l) => l.name);

export function digestIssue(issue: RawIssue, maxBody: number, comments?: RawComment[]): IssueDigest {
  const body = issue.body ?? '';
  const sha = bodySha(body);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    author: issue.user?.login ?? 'ghost',
    labels: labelNames(issue),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    ...parseTitle(issue.title),
    bodyChars: body.length,
    bodySha: sha,
    triage: comments ? findTriageNote(comments, sha) : undefined,
    refs: findRefs(`${issue.title}\n${body}`, issue.number),
    signals: bodySignals(body),
    body: maxBody > 0 ? body.slice(0, maxBody) : '',
  };
}

/** Selection filters; every one that is set must match. */
export interface IssueFilter {
  ranges?: NumberRange[];
  author?: string;
  labels?: string[];
}

export function matchesFilter(issue: RawIssue, filter: IssueFilter): boolean {
  if (issue.pull_request) return false;
  if (filter.ranges && !inRanges(issue.number, filter.ranges)) return false;
  if (filter.author && issue.user?.login.toLowerCase() !== filter.author.toLowerCase()) return false;
  if (filter.labels?.length) {
    const have = labelNames(issue).map((l) => l.toLowerCase());
    if (!filter.labels.every((l) => have.includes(l.toLowerCase()))) return false;
  }
  return true;
}

/** A compact table for scanning; the full records come from `--format json`. The Triaged column
 *  appears only when comments were read. */
export function renderTable(digests: IssueDigest[]): string {
  const yn = (b: boolean) => (b ? 'y' : '');
  const columns: [string, (d: IssueDigest) => string | number][] = [
    ['#', (d) => d.number],
    ['Title', (d) => d.title.replace(/\|/g, '\\|')],
    ['Author', (d) => d.author],
    ['Type', (d) => d.type ?? ''],
    ['Chars', (d) => d.bodyChars],
    ['Refs', (d) => d.refs.map((r) => `#${r}`).join(' ')],
    ['Done-when', (d) => yn(d.signals.hasDoneWhen)],
    ['Open Qs', (d) => d.signals.openQuestions || ''],
    ['Unverified', (d) => yn(d.signals.unverified)],
    ['Blocker', (d) => yn(d.signals.externalBlocker)],
    ['Supersedes', (d) => yn(d.signals.supersedes)],
  ];
  if (digests.some((d) => d.triage !== undefined)) {
    columns.push(['Triaged', (d) => (d.triage ? (d.triage.fresh ? 'fresh' : 'stale') : '')]);
  }
  const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [
    row(columns.map(([name]) => name)),
    row(columns.map(() => '---')),
    ...digests.map((d) => row(columns.map(([, cell]) => cell(d)))),
  ].join('\n');
}
