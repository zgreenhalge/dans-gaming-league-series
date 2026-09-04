// Client-safe domain logic for the admin background-jobs dashboard (#145): the shared job types, the
// "needs attention" predicate, and subject-grouping/ordering. Kept out of queries.ts (which pulls the
// server-only Supabase client) so client components can import it. queries.ts owns only the data
// fetch (`getBackgroundJobs`) and imports these types back.

import { compareMatchRefDesc, formatDuration } from './util';

/**
 * The four background-job pipelines surfaced on the dashboard. `demo_ingest`, `replay_extract`, and
 * `ehog_recompute` are keyed by match; `radar_build` is keyed by map. A const tuple so the getter's
 * `.in()` filter and the `BackgroundJobType` union stay in lockstep.
 */
export const BACKGROUND_JOB_TYPES = ['demo_ingest', 'replay_extract', 'radar_build', 'ehog_recompute'] as const;
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

/** `replay_extract`'s job-type literal, shared so dispatch routes don't each redeclare their own copy. */
export const REPLAY_EXTRACT_JOB_TYPE: BackgroundJobType = 'replay_extract';

/** `ehog_recompute`'s job-type literal, shared so `triggerRatingRecompute()` doesn't redeclare it. */
export const EHOG_RECOMPUTE_JOB_TYPE: BackgroundJobType = 'ehog_recompute';

/** Short badge per pipeline, for a scannable mixed list. */
export const JOB_TYPE_LABEL: Record<BackgroundJobType, string> = {
  demo_ingest: 'demo',
  replay_extract: 'replay',
  radar_build: 'radar',
  ehog_recompute: 'ehog',
};

/**
 * What a background job acts on. Match-keyed jobs (demo/replay) carry match context (incl. the
 * numeric refs used to sort canonically); the map-keyed radar build carries map context. Both carry a
 * ready-to-render `label` + `href` so the dashboard stays presentation-only.
 */
export type BackgroundJobSubject =
  | {
      kind: 'match';
      matchId: number;
      label: string;
      href: string;
      seasonNumber: number | null;
      weekNumber: number | null;
      matchNumber: number | null;
      pickedMap: string | null;
      finalScore: string | null;
      isGauntlet: boolean;
    }
  | { kind: 'map'; mapId: number; slug: string; label: string; href: string };

/**
 * One row of the dashboard — a `background_jobs` row from any pipeline plus enough subject context to
 * label, link, and act on it. Full per-match parse detail lives in the R2 artifact and is shown on the
 * match page's review block — demo rows link there rather than duplicating it.
 */
export interface BackgroundJobRow {
  jobType: BackgroundJobType;
  status: string;
  stage: string | null;
  errorMessage: string | null;
  ghRunUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  subject: BackgroundJobSubject;
  // Parse warnings + quarantine flags from the staged R2 artifact — demo_ingest only, and only while
  // the job still has one (`parsed`/`quarantined`). Empty for every other row.
  warnings: string[];
  quarantineFlags: string[];
  /** Whether the staged result carries a confirm-ready score (demo_ingest only). */
  hasPayload: boolean;
}

/** Demo statuses that still need a human (review or a failure); replay/radar only flag on failure. */
const DEMO_ATTENTION_STATUSES: ReadonlySet<string> = new Set(['parsed', 'quarantined', 'failed']);

/** Statuses with work still in flight, shared by any surface that needs to bucket jobs by whether
 * they're still running (retry/cancel are no-ops while a job is in one of these). */
export const JOB_IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set(['received', 'queued', 'running']);

/**
 * How long an in-progress job can go without a single write to its row before it's treated as stuck
 * rather than still working — comfortably above the longest pipeline's own `timeout-minutes` (25,
 * radar-build; see `docs/github-actions.md`). A GitHub Actions cancellation — the hard timeout, a
 * manual cancel, a lost runner — never reaches the script's `fail()` handler (`cancel-in-progress:
 * false` exists so a *retry* can't orphan a still-live run, but nothing unwinds a run that dies on its
 * own), so nothing else ever moves a genuinely-dead run's row off `received`/`queued`/`running`. One
 * number shared by the Activity feed (tags a stale row as needing attention instead of leaving it
 * silently "in progress") and every dispatch route's in-flight guard (`isJobInFlight` in
 * `background-jobs.ts`) — so a job can never read "still fine" in one place and "stuck" in the other.
 */
export const STALE_IN_FLIGHT_MS = 45 * 60 * 1000;

/**
 * Whether `updatedAt` — the last time this row was written to *at all* — is old enough to call the
 * job stuck. `updatedAt` is a heartbeat, not "how long has this been running": `recordJobStatus()`/
 * `advanceJobStatus()` (`background-jobs.ts`) stamp it on every write unconditionally — every claim,
 * every `stage()` transition (`scripts/job-stage.ts`), every terminal status — so a job that's still
 * actively progressing keeps refreshing it and never reads stale no matter how long the whole run
 * takes, while a script that dies silently simply stops writing. Deliberately *not* based on
 * `startedAt`/`createdAt`: `demo_ingest`'s `createdAt` is preserved across retries by design (see
 * `getJobCreatedAt()`'s doc comment — it's "when the demo was first attempted," not "when this run
 * started"), so a fresh redispatch of a long-stuck row would otherwise still read its ancient
 * `createdAt` and re-flag as stale the instant it lands, before the Action even starts. Basing this on
 * `updatedAt` instead means that same redispatch's own write — which always refreshes `updatedAt` —
 * un-stales the row for free, with no dispatch route needing to remember to reset per-run timestamps
 * by hand.
 */
export function isStale(updatedAt: string | null, nowMs: number): boolean {
  const t = parseIso(updatedAt);
  return t !== null && nowMs - t > STALE_IN_FLIGHT_MS;
}

/** An ISO timestamp parsed to epoch ms, or `null` for a missing/unparseable one — the one NaN-guarded
 *  `new Date(iso).getTime()` step every timestamp check in this file goes through. */
function parseIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** `startedAt` if set, else `createdAt` (a `queued` row may not have `startedAt` yet), parsed to an
 *  epoch ms — or `null` if there's no timestamp to derive one from. Only for `jobDurationLabel`'s "how
 *  long has this run taken" display; staleness detection uses `isStale()`/`updatedAt` instead (see
 *  above) since `startedAt`/`createdAt` don't reliably reset across a redispatch. */
function resolveJobStart(startedAt: string | null, createdAt: string | null): number | null {
  return parseIso(startedAt ?? createdAt);
}

/**
 * Whether an in-progress job has gone quiet long enough to be treated as stuck rather than genuinely
 * still working. `false` for a non-in-progress status.
 */
export function jobIsStale(job: BackgroundJobRow, nowMs: number): boolean {
  if (!JOB_IN_PROGRESS_STATUSES.has(job.status)) return false;
  return isStale(job.updatedAt, nowMs);
}

/**
 * Whether a job needs an operator's attention right now — drives the Needs Attention tab and its
 * count. Demo review states (`parsed`/`quarantined`) and any pipeline's `failed` qualify; in-progress
 * and terminal-success states do not.
 */
export function jobNeedsAttention(job: BackgroundJobRow): boolean {
  if (job.jobType === 'demo_ingest') return DEMO_ATTENTION_STATUSES.has(job.status);
  return job.status === 'failed';
}

/**
 * Elapsed-time label for a job row — "running 2h 14m" while it's still in flight (ticking live off
 * the caller's `nowMs`), or "took 4m" once it's finished. `null` when there's nothing to compute from
 * (no start time yet, or an in-progress job before the caller has a `nowMs` to compare against). Start
 * time falls back to `createdAt` since a `queued` row may not have `startedAt` set yet.
 */
export function jobDurationLabel(job: BackgroundJobRow, nowMs: number | null): string | null {
  const start = resolveJobStart(job.startedAt, job.createdAt);
  if (start === null) return null;
  if (JOB_IN_PROGRESS_STATUSES.has(job.status)) {
    return nowMs === null ? null : `running ${formatDuration(nowMs - start)}`;
  }
  const finish = parseIso(job.finishedAt);
  return finish === null ? null : `took ${formatDuration(finish - start)}`;
}

/** One pipeline's state within a subject group (a match's demo/replay lane, or a map's radar lane). */
export interface JobLane {
  job: BackgroundJobRow;
  needsAttention: boolean;
}

/** All jobs acting on one subject (a match or a map) — one card on the dashboard. */
export interface JobGroup {
  key: string;
  subject: BackgroundJobSubject;
  lanes: JobLane[];
}

// Lane order within a card: demo, then replay, then ehog recompute (radar is the sole lane for maps).
const LANE_ORDER: Record<BackgroundJobType, number> = {
  demo_ingest: 0,
  replay_extract: 1,
  ehog_recompute: 2,
  radar_build: 0,
};

/**
 * Group a flat job list by subject into dashboard cards. Match groups sort by canonical
 * season→week→match order; map groups sort alphabetically; matches come before maps. Pure — the
 * client re-derives the filtered view (by tab + job type) from the returned groups.
 */
export function groupBackgroundJobs(rows: BackgroundJobRow[]): JobGroup[] {
  const byKey = new Map<string, JobGroup>();
  for (const job of rows) {
    const s = job.subject;
    const key = s.kind === 'match' ? `match:${s.matchId}` : `map:${s.mapId}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, subject: s, lanes: [] };
      byKey.set(key, g);
    }
    g.lanes.push({ job, needsAttention: jobNeedsAttention(job) });
  }

  const groups = Array.from(byKey.values());
  for (const g of groups) {
    g.lanes.sort((a, b) => LANE_ORDER[a.job.jobType] - LANE_ORDER[b.job.jobType]);
  }

  groups.sort((a, b) => {
    if (a.subject.kind !== b.subject.kind) return a.subject.kind === 'match' ? -1 : 1;
    if (a.subject.kind === 'match' && b.subject.kind === 'match') {
      return compareMatchRefDesc(
        {
          seasonNumber: a.subject.seasonNumber,
          isGauntlet: a.subject.isGauntlet,
          weekNumber: a.subject.weekNumber ?? 0,
          matchNumber: a.subject.matchNumber ?? 0,
        },
        {
          seasonNumber: b.subject.seasonNumber,
          isGauntlet: b.subject.isGauntlet,
          weekNumber: b.subject.weekNumber ?? 0,
          matchNumber: b.subject.matchNumber ?? 0,
        },
      );
    }
    return a.subject.label.localeCompare(b.subject.label);
  });

  return groups;
}
