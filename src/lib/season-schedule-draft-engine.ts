/**
 * Persists a generated schedule (`buildRosterSchedule()`'s output) into the editable draft tables
 * (`season_schedule_draft_weeks`/`season_schedule_draft_matches`) — the DB-touching counterpart to
 * `season-schedule.ts` / `season-schedule-engine.ts`'s pure planning, mirroring the
 * `gauntlet-bracket.ts` (pure) / `gauntlet-engine.ts` (persists) split.
 *
 * generateSeasonScheduleDraft()/saveSeasonScheduleDraft()/deleteSeasonScheduleDraft()/
 * confirmSeasonScheduleDraft()/rollbackSeasonScheduleDraft() each call one Postgres function
 * (`generate_season_schedule_draft()` etc., `supabase/migrations/`) that does the whole
 * delete/insert-or-update sequence in one DB transaction — a mid-operation failure rolls back
 * cleanly with no partial state, so unlike an earlier version of this file, there's no JS-side
 * compensating cleanup to run. Each function also takes a real Postgres row lock on the season
 * (`select ... for update`) as its first statement, serializing concurrent
 * generate/save/delete/confirm/rollback calls for the same season at the database level, and runs
 * its own "is this season already materialized?" check after acquiring that lock — so two
 * concurrent calls (e.g. a generate and a confirm) can't interleave; whichever acquires the lock
 * first fully commits, including its own check, before the other's lock wait releases.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRosterSchedule } from './season-schedule-engine';
import type { DoubleheaderPolicy } from './season-schedule';
import { getSeasonScheduleDraft, getSeasonRoster, toDraftScheduleWeeks } from './queries';
import {
  validateDraftIntegrity,
  validateDraftCompleteness,
  type DraftScheduleWeek,
  type ValidationIssue,
} from './season-schedule-validation';
import { recordOpsError, clearOpsError } from './ops-errors';

/** Thrown by generateSeasonScheduleDraft()/saveSeasonScheduleDraft()/deleteSeasonScheduleDraft()
 * once a season's schedule has been confirmed (real `weeks` exist) — the draft is superseded at
 * that point and editing it further would give no indication that it's now completely decoupled
 * from what's actually been materialized. `confirmSeasonScheduleDraft()` itself doesn't use this:
 * it already reports the equivalent case as its own typed `{ status: 'already-materialized' }`
 * result rather than throwing, since a repeat confirm attempt is an expected, non-exceptional
 * outcome for its caller to branch on. */
export class ScheduleAlreadyMaterializedError extends Error {
  constructor(seasonId: number) {
    super(`Season ${seasonId}'s schedule has already been confirmed — its draft can no longer be edited`);
    this.name = 'ScheduleAlreadyMaterializedError';
  }
}

/** A cheap, non-transactional read used only to order confirmSeasonScheduleDraft()'s "already
 * materialized" outcome ahead of its "no draft exists" one when both could apply (see its own
 * comment) — never relied on as the actual guard against a race, since every write path's own RPC
 * re-checks this atomically under its row lock regardless. */
async function hasMaterializedSchedule(supabaseAdmin: SupabaseClient, seasonId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('weeks').select('id').eq('season_id', seasonId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Maps ScheduleAlreadyMaterializedError (the season's schedule was already confirmed) to 409, and
 * everything else to 500 — shared by every route in this file's area. */
export function mapScheduleDraftError(err: unknown): { error: string; status: number } {
  if (err instanceof ScheduleAlreadyMaterializedError) {
    return { error: err.message, status: 409 };
  }
  return { error: (err as Error).message, status: 500 };
}

type DraftWeeksRpcStatus = { status: 'ok' | 'already-materialized' };

function toDraftWeeksPayload(weeks: DraftScheduleWeek[]) {
  return weeks.map((w) => ({
    week_number: w.week_number,
    bye_player_id: w.bye_player_id,
    matches: w.matches.map((m) => ({
      match_number: m.match_number,
      shirts_player1_id: m.shirts[0],
      shirts_player2_id: m.shirts[1],
      skins_player1_id: m.skins[0],
      skins_player2_id: m.skins[1],
    })),
  }));
}

/** Replaces a season's entire draft schedule with a freshly generated one, via the
 * `generate_season_schedule_draft()` DB function (delete the existing draft, insert the new plan
 * week by week, one transaction). Always a full regenerate — a season with locked-in results needs
 * the more careful "regenerate only the still-unplayed weeks" operation, which doesn't exist yet
 * (it depends on confirm/materialize existing first) and must not be reached for such a season in
 * the meantime. Refuses with `ScheduleAlreadyMaterializedError` once the season's schedule has been
 * confirmed — `season.status === 'UPCOMING'` alone doesn't rule this out, since confirming
 * deliberately doesn't change status (that's a separate admin action). */
export async function generateSeasonScheduleDraft(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  playerIds: number[],
  options?: { doubleheaderPolicy?: DoubleheaderPolicy },
): Promise<void> {
  const plan = buildRosterSchedule(playerIds, options);

  for (const week of plan) {
    if (week.byePlayerIds.length > 1) {
      // Should be unreachable — doubleheaderPolicy: 'auto' caps byes at one per week by
      // construction, and 'never' is rejected by buildSeasonSchedule() whenever it wouldn't hold.
      throw new Error(
        `generateSeasonScheduleDraft: week ${week.week} has ${week.byePlayerIds.length} byes, but the draft schema only stores one (bye_player_id)`,
      );
    }
  }

  const payload = toDraftWeeksPayload(
    plan.map((week) => ({
      week_number: week.week,
      bye_player_id: week.byePlayerIds[0] ?? null,
      matches: week.matches.map((m, i) => ({ match_number: i + 1, shirts: m.shirts, skins: m.skins })),
    })),
  );

  const { data, error } = await supabaseAdmin.rpc('generate_season_schedule_draft', {
    p_season_id: seasonId,
    p_weeks: payload,
  });
  if (error) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'schedule_generate', `Schedule generate failed: ${error.message}`);
    throw error;
  }
  if ((data as DraftWeeksRpcStatus).status === 'already-materialized') {
    throw new ScheduleAlreadyMaterializedError(seasonId);
  }
  await clearOpsError(supabaseAdmin, 'season', seasonId, 'schedule_generate');
}

/** Deletes a season's entire draft schedule via the `delete_season_schedule_draft()` DB function.
 * Refuses with `ScheduleAlreadyMaterializedError` once the season's schedule has been confirmed —
 * clearing the draft at that point wouldn't touch the real materialized `weeks`/`matches`, but it
 * would destroy the one record of what was actually confirmed, with nothing to show it's now gone. */
export async function deleteSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('delete_season_schedule_draft', { p_season_id: seasonId });
  if (error) throw error;
  if ((data as DraftWeeksRpcStatus).status === 'already-materialized') {
    throw new ScheduleAlreadyMaterializedError(seasonId);
  }
}

export type SaveDraftResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

/** Applies a hand-edit to an existing draft via the `save_season_schedule_draft()` DB function —
 * reassigns which players occupy which slots, keyed by `(week_number, match_number)`. Unlike
 * `generateSeasonScheduleDraft()`, this never inserts or deletes rows: the editor only ever
 * reassigns players within the week/match structure generation already created, so every
 * `(week_number, match_number)` in `weeks` is expected to already have a matching draft row —
 * regenerating (which does add/remove rows) is a separate operation; the DB function raises if one
 * is missing. Refuses (without writing anything) if the proposed draft fails
 * `validateDraftIntegrity()` against the season's current DB roster (not whatever roster the
 * client last had) — never trusting client-side validation alone. Also refuses with
 * `ScheduleAlreadyMaterializedError` once the season's schedule has been confirmed — hand-editing a
 * superseded draft would give no indication it's now decoupled from the real schedule. */
export async function saveSeasonScheduleDraft(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  weeks: DraftScheduleWeek[],
): Promise<SaveDraftResult> {
  const roster = await getSeasonRoster(seasonId);

  const integrity = validateDraftIntegrity(weeks, roster.map((r) => r.player_id));
  if (!integrity.ok) {
    return { ok: false, issues: integrity.issues };
  }

  const { data, error } = await supabaseAdmin.rpc('save_season_schedule_draft', {
    p_season_id: seasonId,
    p_weeks: toDraftWeeksPayload(weeks),
  });
  if (error) throw error;
  if ((data as DraftWeeksRpcStatus).status === 'already-materialized') {
    throw new ScheduleAlreadyMaterializedError(seasonId);
  }

  return { ok: true };
}

export type ConfirmResult =
  | { status: 'already-materialized' }
  | { status: 'no-draft' }
  | {
      status: 'invalid';
      integrityIssues: ValidationIssue[];
      missingTeammatePairs: [number, number][];
      missingOpponentPairs: [number, number][];
    }
  | { status: 'confirmed'; weeksCreated: number; matchesCreated: number };

/** Materializes a season's draft into real `weeks`/`matches`/`player_match_stats` rows, via the
 * `confirm_season_schedule_draft()` DB function — `player_match_stats` gets zero-value placeholder
 * rows per participant, same as `materializePod()` does for a gauntlet match before it's played.
 * Refuses if the season already has any real `weeks` (no double-materialize) or if the draft fails
 * either check — both `validateDraftIntegrity()` and `validateDraftCompleteness()` must pass, not
 * just integrity; confirming is the one place completeness stops being advisory. The draft rows
 * themselves are left untouched either way, so a rejected confirm can just be re-attempted after
 * more edits.
 *
 * The `hasMaterializedSchedule()` read below is a non-transactional pre-check, not the actual
 * guard (the DB function re-checks atomically under its own row lock) — it exists only so
 * "already confirmed" reports ahead of "no draft exists yet" when a season somehow has neither a
 * draft nor this check (this can't happen through normal use, since confirm never touches draft
 * rows and delete refuses once materialized, but the ordering is worth preserving over silently
 * reporting the wrong reason). */
export async function confirmSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<ConfirmResult> {
  if (await hasMaterializedSchedule(supabaseAdmin, seasonId)) {
    return { status: 'already-materialized' };
  }

  const [draftWithPlayers, roster] = await Promise.all([getSeasonScheduleDraft(seasonId), getSeasonRoster(seasonId)]);

  // Without this, an empty draft against a 0-1 player roster would pass both checks vacuously
  // (nothing to violate, no pairs to require) and "confirm" a schedule with 0 weeks/matches.
  if (draftWithPlayers.length === 0) {
    return { status: 'no-draft' };
  }

  const draftWeeks = toDraftScheduleWeeks(draftWithPlayers);
  const rosterPlayerIds = roster.map((r) => r.player_id);

  const integrity = validateDraftIntegrity(draftWeeks, rosterPlayerIds);
  const completeness = validateDraftCompleteness(draftWeeks, rosterPlayerIds);

  if (!integrity.ok || !completeness.complete) {
    return {
      status: 'invalid',
      integrityIssues: integrity.issues,
      missingTeammatePairs: completeness.missingTeammatePairs,
      missingOpponentPairs: completeness.missingOpponentPairs,
    };
  }

  const { data, error } = await supabaseAdmin.rpc('confirm_season_schedule_draft', { p_season_id: seasonId });
  if (error) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'schedule_confirm', `Schedule confirm failed: ${error.message}`);
    throw error;
  }

  const result = data as { status: 'already-materialized' | 'no-draft' | 'confirmed'; weeks_created?: number; matches_created?: number };
  if (result.status === 'already-materialized') return { status: 'already-materialized' };
  if (result.status === 'no-draft') return { status: 'no-draft' };

  await clearOpsError(supabaseAdmin, 'season', seasonId, 'schedule_confirm');
  return { status: 'confirmed', weeksCreated: result.weeks_created!, matchesCreated: result.matches_created! };
}

export type RollbackResult =
  | { status: 'not-materialized' }
  | { status: 'rolled-back'; weeksDeleted: number; protectedWeekNumbers: number[] };

/** Un-confirms a season's real schedule via the `rollback_season_schedule_draft()` DB function:
 * deletes `weeks` (cascading `matches`/`player_match_stats`, all `on delete cascade`) restricted to
 * weeks with no played match yet — a played match is never deleted, so a week with even one is left
 * alone entirely and reported back in `protectedWeekNumbers`. The draft this season was originally
 * confirmed from is never touched, so once every remaining real week is either rolled back or
 * played, the season is back to (or ends up permanently short of) a re-editable draft state the
 * normal generate/save/delete/confirm flow can pick back up. A season with no real schedule at all
 * reports `not-materialized` rather than a no-op `rolled-back` with nothing deleted, so a caller can
 * tell "there was nothing to roll back" apart from "there was, and none of it qualified". */
export async function rollbackSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<RollbackResult> {
  const { data, error } = await supabaseAdmin.rpc('rollback_season_schedule_draft', { p_season_id: seasonId });
  if (error) throw error;

  const result = data as { status: 'not-materialized' | 'rolled-back'; weeks_deleted?: number; protected_week_numbers?: number[] };
  if (result.status === 'not-materialized') return { status: 'not-materialized' };
  return {
    status: 'rolled-back',
    weeksDeleted: result.weeks_deleted ?? 0,
    protectedWeekNumbers: result.protected_week_numbers ?? [],
  };
}
