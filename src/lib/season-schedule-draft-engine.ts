/**
 * Persists a generated schedule (`buildRosterSchedule()`'s output) into the editable draft tables
 * (`season_schedule_draft_weeks`/`season_schedule_draft_matches`) — the DB-touching counterpart to
 * `season-schedule.ts` / `season-schedule-engine.ts`'s pure planning, mirroring the
 * `gauntlet-bracket.ts` (pure) / `gauntlet-engine.ts` (persists) split.
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

/** Thrown when a caller tries to generate/save/delete a season's draft schedule while another such
 * operation is already in flight for the same season — see claimScheduleDraftLock(). */
export class ScheduleDraftLockedError extends Error {
  constructor(seasonId: number) {
    super(`Another schedule draft operation is already in progress for season ${seasonId} — try again shortly`);
    this.name = 'ScheduleDraftLockedError';
  }
}

// generateSeasonScheduleDraft()/saveSeasonScheduleDraft()/deleteSeasonScheduleDraft() are each a
// sequence of several Supabase calls, not one DB transaction, so two overlapping admin requests for
// the same season could otherwise interleave their delete/insert or update sequences. A Postgres
// advisory lock would only hold within one transaction/connection, which none of these span, so
// instead `seasons.schedule_draft_locked_at` is claimed via the same atomic-conditional-UPDATE
// pattern as the roster-edit cooldown (PATCH /api/players/me/name): whichever request's UPDATE
// commits first is the only one whose WHERE the other can still match. A lock older than
// SCHEDULE_DRAFT_LOCK_STALE_MS is treated as free, so a request that crashes mid-operation can't
// wedge the season's draft tooling permanently.
const SCHEDULE_DRAFT_LOCK_STALE_MS = 60_000;

async function claimScheduleDraftLock(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const cutoff = new Date(Date.now() - SCHEDULE_DRAFT_LOCK_STALE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('seasons')
    .update({ schedule_draft_locked_at: new Date().toISOString() })
    .eq('id', seasonId)
    .or(`schedule_draft_locked_at.is.null,schedule_draft_locked_at.lte.${cutoff}`)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ScheduleDraftLockedError(seasonId);
}

async function releaseScheduleDraftLock(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { error } = await supabaseAdmin.from('seasons').update({ schedule_draft_locked_at: null }).eq('id', seasonId);
  if (error) throw error;
}

/** Replaces a season's entire draft schedule with a freshly generated one: existing draft matches
 * and weeks are deleted first (matches before weeks, for the FK), then the new plan is inserted
 * week by week. Always a full regenerate — a season with locked-in results needs the more careful
 * "regenerate only the still-unplayed weeks" operation, which doesn't exist yet (it depends on
 * confirm/materialize existing first) and must not be reached for such a season in the meantime. */
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

  await claimScheduleDraftLock(supabaseAdmin, seasonId);
  try {
    await deleteSeasonScheduleDraftRows(supabaseAdmin, seasonId);

    for (const week of plan) {
      const { data: weekRow, error: weekErr } = await supabaseAdmin
        .from('season_schedule_draft_weeks')
        .insert({
          season_id: seasonId,
          week_number: week.week,
          bye_player_id: week.byePlayerIds[0] ?? null,
        })
        .select('id')
        .single();
      if (weekErr) throw weekErr;
      const weekId = (weekRow as { id: number }).id;

      const matchRows = week.matches.map((m, i) => ({
        draft_week_id: weekId,
        match_number: i + 1,
        shirts_player1_id: m.shirts[0],
        shirts_player2_id: m.shirts[1],
        skins_player1_id: m.skins[0],
        skins_player2_id: m.skins[1],
      }));
      const { error: matchErr } = await supabaseAdmin.from('season_schedule_draft_matches').insert(matchRows);
      if (matchErr) throw matchErr;
    }
  } finally {
    await releaseScheduleDraftLock(supabaseAdmin, seasonId);
  }
}

/** The actual delete, unguarded by the lock — shared by deleteSeasonScheduleDraft() (which claims
 * the lock itself) and generateSeasonScheduleDraft() (which already holds it, so calling the locked
 * export from inside would immediately fail against its own just-claimed lock). */
async function deleteSeasonScheduleDraftRows(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { data: existingWeeks, error: existingErr } = await supabaseAdmin
    .from('season_schedule_draft_weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (existingErr) throw existingErr;
  const weekIds = ((existingWeeks ?? []) as { id: number }[]).map((w) => w.id);
  if (weekIds.length === 0) return;

  const { error: delMatchesErr } = await supabaseAdmin
    .from('season_schedule_draft_matches')
    .delete()
    .in('draft_week_id', weekIds);
  if (delMatchesErr) throw delMatchesErr;

  const { error: delWeeksErr } = await supabaseAdmin
    .from('season_schedule_draft_weeks')
    .delete()
    .eq('season_id', seasonId);
  if (delWeeksErr) throw delWeeksErr;
}

/** Deletes a season's entire draft schedule (matches, then weeks), with no confirm/materialize
 * side effects — for clearing a draft out from under a season that no longer needs one. */
export async function deleteSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  await claimScheduleDraftLock(supabaseAdmin, seasonId);
  try {
    await deleteSeasonScheduleDraftRows(supabaseAdmin, seasonId);
  } finally {
    await releaseScheduleDraftLock(supabaseAdmin, seasonId);
  }
}

export type SaveDraftResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

/** Applies a hand-edit to an existing draft — reassigns which players occupy which slots via plain
 * UPDATEs, keyed by `(week_number, match_number)`. Unlike `generateSeasonScheduleDraft()`, this
 * never inserts or deletes rows: the editor only ever reassigns players within the week/match
 * structure generation already created, so every `(week_number, match_number)` in `weeks` is
 * expected to already have a matching draft row — regenerating (which does add/remove rows) is a
 * separate operation. Refuses (without writing anything) if the proposed draft fails
 * `validateDraftIntegrity()` against the season's current DB roster (not whatever roster the
 * client last had) — never trusting client-side validation alone. */
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

  await claimScheduleDraftLock(supabaseAdmin, seasonId);
  try {
    const { data: weekRows, error: weekErr } = await supabaseAdmin
      .from('season_schedule_draft_weeks')
      .select('id, week_number')
      .eq('season_id', seasonId);
    if (weekErr) throw weekErr;
    const weekIdByNumber = new Map(
      ((weekRows ?? []) as { id: number; week_number: number }[]).map((w) => [w.week_number, w.id]),
    );

    const { data: matchRows, error: matchErr } = await supabaseAdmin
      .from('season_schedule_draft_matches')
      .select('id, draft_week_id, match_number')
      .in('draft_week_id', Array.from(weekIdByNumber.values()));
    if (matchErr) throw matchErr;
    const matchIdByKey = new Map(
      ((matchRows ?? []) as { id: number; draft_week_id: number; match_number: number }[]).map((m) => [
        `${m.draft_week_id}:${m.match_number}`,
        m.id,
      ]),
    );

    for (const week of weeks) {
      const weekId = weekIdByNumber.get(week.week_number);
      if (weekId == null) {
        throw new Error(`saveSeasonScheduleDraft: no draft week ${week.week_number} exists for season ${seasonId}`);
      }

      const { error: weekUpdateErr } = await supabaseAdmin
        .from('season_schedule_draft_weeks')
        .update({ bye_player_id: week.bye_player_id })
        .eq('id', weekId);
      if (weekUpdateErr) throw weekUpdateErr;

      for (const m of week.matches) {
        const matchId = matchIdByKey.get(`${weekId}:${m.match_number}`);
        if (matchId == null) {
          throw new Error(
            `saveSeasonScheduleDraft: no draft match ${m.match_number} in week ${week.week_number} exists for season ${seasonId}`,
          );
        }

        const { error: matchUpdateErr } = await supabaseAdmin
          .from('season_schedule_draft_matches')
          .update({
            shirts_player1_id: m.shirts[0],
            shirts_player2_id: m.shirts[1],
            skins_player1_id: m.skins[0],
            skins_player2_id: m.skins[1],
          })
          .eq('id', matchId);
        if (matchUpdateErr) throw matchUpdateErr;
      }
    }
  } finally {
    await releaseScheduleDraftLock(supabaseAdmin, seasonId);
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

const ZERO_MATCH_STATS = {
  kills: 0,
  assists: 0,
  deaths: 0,
  damage: 0,
  adr: 0,
  rounds_played: 0,
  rounds_won: 0,
  is_win: false,
};

/** Materializes a season's draft into real `weeks`/`matches`/`player_match_stats` rows —
 * `player_match_stats` gets zero-value placeholder rows per participant, same as
 * `materializePod()` does for a gauntlet match before it's played. Refuses if the season already
 * has any real `weeks` (no double-materialize) or if the draft fails either check — both
 * `validateDraftIntegrity()` and `validateDraftCompleteness()` must pass, not just integrity;
 * confirming is the one place completeness stops being advisory. The draft rows themselves are
 * left untouched either way, so a rejected confirm can just be re-attempted after more edits. */
export async function confirmSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<ConfirmResult> {
  const { data: existingRealWeeks, error: existingErr } = await supabaseAdmin
    .from('weeks')
    .select('id')
    .eq('season_id', seasonId)
    .limit(1);
  if (existingErr) throw existingErr;
  if ((existingRealWeeks ?? []).length > 0) {
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

  for (const week of draftWeeks) {
    const { data: weekRow, error: weekErr } = await supabaseAdmin
      .from('weeks')
      .insert({ season_id: seasonId, week_number: week.week_number, bye_player_id: week.bye_player_id })
      .select('id')
      .single();
    if (weekErr) throw weekErr;
    const weekId = (weekRow as { id: number }).id;

    for (const m of week.matches) {
      const { data: matchRow, error: matchErr } = await supabaseAdmin
        .from('matches')
        .insert({
          week_id: weekId,
          match_number: m.match_number,
          is_playoff_game: false,
          final_score: null,
          picked_map: null,
          shirts_ban: null,
          shirts_ban2: null,
          skins_ban1: null,
          skins_ban2: null,
          shirts_pick: null,
          skins_starting_side: null,
        })
        .select('id')
        .single();
      if (matchErr) throw matchErr;
      const matchId = (matchRow as { id: number }).id;

      const statRows = [
        { match_id: matchId, player_id: m.shirts[0], faction: 'SHIRTS', ...ZERO_MATCH_STATS },
        { match_id: matchId, player_id: m.shirts[1], faction: 'SHIRTS', ...ZERO_MATCH_STATS },
        { match_id: matchId, player_id: m.skins[0], faction: 'SKINS', ...ZERO_MATCH_STATS },
        { match_id: matchId, player_id: m.skins[1], faction: 'SKINS', ...ZERO_MATCH_STATS },
      ];
      const { error: statsErr } = await supabaseAdmin.from('player_match_stats').insert(statRows);
      if (statsErr) throw statsErr;
    }
  }

  // Every insert throws on error, so getting here means every week/match in the plan was created —
  // no need to track counts through the loop.
  return {
    status: 'confirmed',
    weeksCreated: draftWeeks.length,
    matchesCreated: draftWeeks.reduce((n, w) => n + w.matches.length, 0),
  };
}
