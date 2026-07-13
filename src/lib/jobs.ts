// Client-safe domain logic for the admin background-jobs dashboard (#145): the shared job types, the
// "needs attention" predicate, and subject-grouping/ordering. Kept out of queries.ts (which pulls the
// server-only Supabase client) so client components can import it. queries.ts owns only the data
// fetch (`getBackgroundJobs`) and imports these types back.

import { compareMatchRefDesc } from './util';

/**
 * The three background-job pipelines surfaced on the dashboard. `demo_ingest` and `replay_extract`
 * are keyed by match; `radar_build` is keyed by map. A const tuple so the getter's `.in()` filter and
 * the `BackgroundJobType` union stay in lockstep.
 */
export const BACKGROUND_JOB_TYPES = ['demo_ingest', 'replay_extract', 'radar_build'] as const;
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];

/** `replay_extract`'s job-type literal, shared so dispatch routes don't each redeclare their own copy. */
export const REPLAY_EXTRACT_JOB_TYPE: BackgroundJobType = 'replay_extract';

/** Short badge per pipeline, for a scannable mixed list. */
export const JOB_TYPE_LABEL: Record<BackgroundJobType, string> = {
  demo_ingest: 'demo',
  replay_extract: 'replay',
  radar_build: 'radar',
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

/**
 * Whether a job needs an operator's attention right now — drives the Needs Attention tab and its
 * count. Demo review states (`parsed`/`quarantined`) and any pipeline's `failed` qualify; in-progress
 * and terminal-success states do not.
 */
export function jobNeedsAttention(job: BackgroundJobRow): boolean {
  if (job.jobType === 'demo_ingest') return DEMO_ATTENTION_STATUSES.has(job.status);
  return job.status === 'failed';
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

// Lane order within a card: demo before replay (radar is the sole lane for maps).
const LANE_ORDER: Record<BackgroundJobType, number> = {
  demo_ingest: 0,
  replay_extract: 1,
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
