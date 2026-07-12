import { gunzipMaybe } from '../gzip';
import { supabase } from '../supabase';
import { getR2Object, demoResultKey } from '../r2';
import { DEMO_INGEST_JOB_TYPE, type DemoIngestResult } from '../demo/ingestResult';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
  type BackgroundJobSubject,
  type BackgroundJobRow,
} from '../jobs';
import type { OpsErrorEntityType } from '../ops-errors';
import type { Match, Week, Season } from '../types';
import { matchLabel, extractSeasonNumber } from '../util';


/** Job statuses that still have a staged `demo-result.json` artifact in R2 to read detail from. */
const DEMO_INGEST_STAGED_STATUSES: ReadonlySet<string> = new Set(['parsed', 'quarantined']);

/** Display context for a match-keyed background job (`buildJobSubject` turns this into a subject). */
interface MatchJobContext {
  label: string;
  seasonNumber: number | null;
  weekNumber: number | null;
  matchNumber: number | null;
  pickedMap: string | null;
  finalScore: string | null;
  isGauntlet: boolean;
}

/**
 * Batch-load display context (match → week → season) for match-keyed background jobs in
 * three queries, not per-row. Shared by the jobs dashboard so demo and replay rows label
 * identically.
 */
async function loadMatchJobContext(matchIds: number[]): Promise<Map<number, MatchJobContext>> {
  const out = new Map<number, MatchJobContext>();
  if (!matchIds.length) return out;

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, match_number, picked_map, final_score, week_id')
    .in('id', matchIds);
  const matches = (matchRows ?? []) as Pick<
    Match,
    'id' | 'match_number' | 'picked_map' | 'final_score' | 'week_id'
  >[];

  const weekIds = Array.from(new Set(matches.map((m) => m.week_id)));
  const { data: weekRows } = weekIds.length
    ? await supabase.from('weeks').select('id, week_number, season_id').in('id', weekIds)
    : { data: [] as Pick<Week, 'id' | 'week_number' | 'season_id'>[] };
  const weeks = (weekRows ?? []) as Pick<Week, 'id' | 'week_number' | 'season_id'>[];

  const seasonIds = Array.from(new Set(weeks.map((w) => w.season_id)));
  const { data: seasonRows } = seasonIds.length
    ? await supabase.from('seasons').select('id, name, is_gauntlet').in('id', seasonIds)
    : { data: [] as Pick<Season, 'id' | 'name' | 'is_gauntlet'>[] };
  const seasons = (seasonRows ?? []) as Pick<Season, 'id' | 'name' | 'is_gauntlet'>[];

  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  for (const m of matches) {
    const w = weekById.get(m.week_id) ?? null;
    const s = w ? seasonById.get(w.season_id) ?? null : null;
    out.set(m.id, {
      label: matchLabel({
        matchId: m.id,
        seasonName: s?.name ?? null,
        weekNumber: w?.week_number ?? null,
        matchNumber: m.match_number ?? null,
      }),
      seasonNumber: s?.name ? extractSeasonNumber(s.name) : null,
      weekNumber: w?.week_number ?? null,
      matchNumber: m.match_number ?? null,
      pickedMap: m.picked_map ?? null,
      finalScore: m.final_score ?? null,
      isGauntlet: s?.is_gauntlet ?? false,
    });
  }
  return out;
}

/** Resolve a job row's subject (match vs map) to a labeled, linkable descriptor. */
function buildJobSubject(
  job: { jobType: BackgroundJobType; matchId: number | null; mapId: number | null },
  matchCtx: Map<number, MatchJobContext>,
  mapById: Map<number, { name: string; slug: string }>,
): BackgroundJobSubject {
  if (job.jobType === 'radar_build') {
    const mapId = job.mapId ?? 0;
    const m = mapId ? mapById.get(mapId) : undefined;
    return {
      kind: 'map',
      mapId,
      slug: m?.slug ?? '',
      label: m?.name ?? `Map #${mapId}`,
      href: m?.slug ? `/maps/${m.slug}` : '/maps',
    };
  }
  const matchId = job.matchId ?? 0;
  const ctx = matchId ? matchCtx.get(matchId) : undefined;
  return {
    kind: 'match',
    matchId,
    label: ctx?.label ?? `Match #${matchId}`,
    href: `/matches/${matchId}`,
    seasonNumber: ctx?.seasonNumber ?? null,
    weekNumber: ctx?.weekNumber ?? null,
    matchNumber: ctx?.matchNumber ?? null,
    pickedMap: ctx?.pickedMap ?? null,
    finalScore: ctx?.finalScore ?? null,
    isGauntlet: ctx?.isGauntlet ?? false,
  };
}

/**
 * All background jobs across every pipeline, newest activity first. The admin jobs
 * dashboard (#145) is the single notification channel for anything that would otherwise
 * fail silently. Defensive: returns `[]` if `background_jobs` isn't present yet so the
 * page never hard-fails.
 */
export async function getBackgroundJobs(): Promise<BackgroundJobRow[]> {
  try {
    const { data: jobs, error } = await supabase
      .from('background_jobs')
      .select(
        'job_type, match_id, map_id, status, stage, error_message, gh_run_url, created_at, updated_at, started_at, finished_at',
      )
      .in('job_type', [...BACKGROUND_JOB_TYPES])
      .order('updated_at', { ascending: false });
    if (error || !jobs) return [];

    type JobRow = {
      job_type: BackgroundJobType;
      match_id: number | null;
      map_id: number | null;
      status: string | null;
      stage: string | null;
      error_message: string | null;
      gh_run_url: string | null;
      created_at: string | null;
      updated_at: string | null;
      started_at: string | null;
      finished_at: string | null;
    };
    const jobRows = jobs as JobRow[];

    // Batch subject context: match → week → season for match-keyed jobs, and maps for radar.
    const matchIds = Array.from(
      new Set(jobRows.filter((j) => j.match_id != null).map((j) => j.match_id as number)),
    );
    const mapIds = Array.from(
      new Set(jobRows.filter((j) => j.map_id != null).map((j) => j.map_id as number)),
    );

    const matchCtx = await loadMatchJobContext(matchIds);

    const { data: mapRows } = mapIds.length
      ? await supabase.from('maps').select('id, name, slug').in('id', mapIds)
      : { data: [] as { id: number; name: string; slug: string }[] };
    const mapById = new Map(
      ((mapRows ?? []) as { id: number; name: string; slug: string }[]).map((m) => [m.id, m]),
    );

    // Enrich staged demo-ingest jobs with parse warnings / quarantine flags from R2 (bounded:
    // only `parsed`/`quarantined` rows still have an artifact). Read in parallel.
    const staged = jobRows.filter(
      (j) =>
        j.job_type === DEMO_INGEST_JOB_TYPE &&
        j.match_id != null &&
        DEMO_INGEST_STAGED_STATUSES.has(j.status ?? ''),
    );
    const detailByMatch = new Map<number, { warnings: string[]; quarantineFlags: string[]; hasPayload: boolean }>();
    await Promise.all(
      staged.map(async (j) => {
        const matchId = j.match_id as number;
        try {
          const buf = await getR2Object(demoResultKey(matchId));
          if (!buf) return;
          const r = JSON.parse(gunzipMaybe(buf).toString()) as DemoIngestResult;
          detailByMatch.set(matchId, {
            warnings: r.warnings ?? [],
            quarantineFlags: r.quarantineFlags ?? [],
            hasPayload: r.payload != null,
          });
        } catch {
          /* corrupt/partial artifact — leave detail empty, status still shows */
        }
      }),
    );

    return jobRows.map((j): BackgroundJobRow => {
      const detail = j.match_id != null ? detailByMatch.get(j.match_id) : undefined;
      return {
        jobType: j.job_type,
        status: j.status ?? 'unknown',
        stage: j.stage,
        errorMessage: j.error_message,
        ghRunUrl: j.gh_run_url,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
        subject: buildJobSubject(
          { jobType: j.job_type, matchId: j.match_id, mapId: j.map_id },
          matchCtx,
          mapById,
        ),
        warnings: detail?.warnings ?? [],
        quarantineFlags: detail?.quarantineFlags ?? [],
        hasPayload: detail?.hasPayload ?? false,
      };
    });
  } catch {
    return [];
  }
}

export interface OpsErrorRow {
  id: number;
  entityType: OpsErrorEntityType;
  entityId: number;
  operation: string;
  message: string;
  occurredAt: string;
  /** Human-readable name for the row's entity — a season/match/player name, or "EHOG Recompute"
   * for the system-wide singleton — resolved here so the admin UI never has to. */
  label: string;
}

/**
 * Every currently-live best-effort-operation failure, newest first — the single admin surface for
 * anything recorded via `recordOpsError()` (`src/lib/ops-errors.ts`). Resolves each row's
 * `entity_id` to a display name with a handful of batched follow-up queries, one per entity type
 * present.
 */
export async function getOpsErrors(): Promise<OpsErrorRow[]> {
  const { data, error } = await supabase
    .from('ops_errors')
    .select('id, entity_type, entity_id, operation, message, occurred_at')
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  type Row = {
    id: number;
    entity_type: OpsErrorEntityType;
    entity_id: number;
    operation: string;
    message: string;
    occurred_at: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const seasonIds = rows.filter((r) => r.entity_type === 'season').map((r) => r.entity_id);
  const matchIds = rows.filter((r) => r.entity_type === 'match').map((r) => r.entity_id);

  const [seasonRes, matchRes] = await Promise.all([
    seasonIds.length
      ? supabase.from('seasons').select('id, name').in('id', seasonIds)
      : Promise.resolve({ data: [] }),
    matchIds.length
      ? supabase.from('matches').select('id, match_number, weeks(week_number, seasons(name))').in('id', matchIds)
      : Promise.resolve({ data: [] }),
  ]);

  const seasonName = new Map(((seasonRes.data ?? []) as { id: number; name: string }[]).map((s) => [s.id, s.name]));
  type MatchJoinRow = {
    id: number;
    match_number: number | null;
    weeks: { week_number: number | null; seasons: { name: string | null } | null } | null;
  };
  const matchLbl = new Map(
    ((matchRes.data ?? []) as unknown as MatchJoinRow[]).map((m) => [
      m.id,
      matchLabel({
        matchId: m.id,
        seasonName: m.weeks?.seasons?.name,
        weekNumber: m.weeks?.week_number,
        matchNumber: m.match_number,
      }),
    ]),
  );

  const labelFor = (r: Row): string => {
    switch (r.entity_type) {
      case 'season':
        return seasonName.get(r.entity_id) ?? `Season #${r.entity_id}`;
      case 'match':
        return matchLbl.get(r.entity_id) ?? `Match #${r.entity_id}`;
      case 'system':
        return 'EHOG Recompute';
    }
  };

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    message: r.message,
    occurredAt: r.occurred_at,
    label: labelFor(r),
  }));
}
