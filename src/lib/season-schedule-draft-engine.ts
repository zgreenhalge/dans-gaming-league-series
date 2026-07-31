/**
 * Persists a generated schedule (`buildRosterSchedule()`'s output) into the editable draft tables
 * (`season_schedule_draft_weeks`/`season_schedule_draft_matches`) — the DB-touching counterpart to
 * `season-schedule.ts` / `season-schedule-engine.ts`'s pure planning, mirroring the
 * `gauntlet-bracket.ts` (pure) / `gauntlet-engine.ts` (persists) split.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRosterSchedule } from './season-schedule-engine';
import type { DoubleheaderPolicy } from './season-schedule';
import { getSeasonScheduleDraft, getSeasonRoster } from './queries';
import {
  validateDraftIntegrity,
  validateDraftCompleteness,
  type DraftScheduleWeek,
  type ValidationIssue,
} from './season-schedule-validation';

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

  await deleteSeasonScheduleDraft(supabaseAdmin, seasonId);

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
}

/** Deletes a season's entire draft schedule (matches, then weeks), with no confirm/materialize
 * side effects — for clearing a draft out from under a season that no longer needs one. */
export async function deleteSeasonScheduleDraft(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
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

export type ConfirmResult =
  | { status: 'already-materialized' }
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

  const draftWeeks: DraftScheduleWeek[] = draftWithPlayers.map((w) => ({
    week_number: w.week_number,
    bye_player_id: w.bye_player?.id ?? null,
    matches: w.matches.map((m) => ({
      match_number: m.match_number,
      shirts: [m.shirts[0].id, m.shirts[1].id] as [number, number],
      skins: [m.skins[0].id, m.skins[1].id] as [number, number],
    })),
  }));

  const integrity = validateDraftIntegrity(draftWeeks);
  const completeness = validateDraftCompleteness(
    draftWeeks,
    roster.map((r) => r.player_id),
  );

  if (!integrity.ok || !completeness.complete) {
    return {
      status: 'invalid',
      integrityIssues: integrity.issues,
      missingTeammatePairs: completeness.missingTeammatePairs,
      missingOpponentPairs: completeness.missingOpponentPairs,
    };
  }

  let weeksCreated = 0;
  let matchesCreated = 0;

  for (const week of draftWeeks) {
    const { data: weekRow, error: weekErr } = await supabaseAdmin
      .from('weeks')
      .insert({ season_id: seasonId, week_number: week.week_number, bye_player_id: week.bye_player_id })
      .select('id')
      .single();
    if (weekErr) throw weekErr;
    const weekId = (weekRow as { id: number }).id;
    weeksCreated++;

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
      matchesCreated++;

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

  return { status: 'confirmed', weeksCreated, matchesCreated };
}
