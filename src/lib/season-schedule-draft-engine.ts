/**
 * Persists a generated schedule (`buildRosterSchedule()`'s output) into the editable draft tables
 * (`season_schedule_draft_weeks`/`season_schedule_draft_matches`) — the DB-touching counterpart to
 * `season-schedule.ts` / `season-schedule-engine.ts`'s pure planning, mirroring the
 * `gauntlet-bracket.ts` (pure) / `gauntlet-engine.ts` (persists) split.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRosterSchedule } from './season-schedule-engine';
import type { DoubleheaderPolicy } from './season-schedule';

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

  const { data: existingWeeks, error: existingErr } = await supabaseAdmin
    .from('season_schedule_draft_weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (existingErr) throw existingErr;
  const existingWeekIds = ((existingWeeks ?? []) as { id: number }[]).map((w) => w.id);

  if (existingWeekIds.length > 0) {
    const { error: delMatchesErr } = await supabaseAdmin
      .from('season_schedule_draft_matches')
      .delete()
      .in('draft_week_id', existingWeekIds);
    if (delMatchesErr) throw delMatchesErr;

    const { error: delWeeksErr } = await supabaseAdmin
      .from('season_schedule_draft_weeks')
      .delete()
      .eq('season_id', seasonId);
    if (delWeeksErr) throw delWeeksErr;
  }

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
