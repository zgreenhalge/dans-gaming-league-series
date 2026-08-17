// Direct Supabase admin access for E2E fixture setup/teardown — deliberately bypasses the app's own
// auth/API layer (unlike the tests themselves, which drive everything through the UI) so seeding a
// season doesn't depend on the very admin flow the tests exist to exercise. Mirrors `getAdminClient()`
// (`src/lib/supabase-admin.ts`) but lives outside `src/` since it's test-only, Node-script code, not
// part of the app.

import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'E2E fixtures need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set — see docs/e2e.md.',
    );
  }
  return createClient(url, key);
}

export interface TestSeason {
  seasonId: number;
  playerIds: number[];
}

/** A regular (non-gauntlet) season with a 7-player roster — the same roster size already exercised
 *  by `season-schedule-draft-engine.test.ts`'s `buildRosterSchedule()` coverage, so `generate()` is
 *  known to produce a complete draft without a doubleheader-policy conflict. Named with an `E2E `
 *  prefix and a timestamp so a season left behind by an interrupted run is easy to spot and hand-clean
 *  in the Supabase dashboard. */
export async function seedSchedulableSeason(): Promise<TestSeason> {
  const supabase = adminClient();

  const { data: maps, error: mapsErr } = await supabase.from('maps').select('name').limit(5);
  if (mapsErr) throw mapsErr;
  if (!maps || maps.length < 5) {
    throw new Error('E2E fixture needs at least 5 rows in `maps` — seed the target database first.');
  }

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id')
    .order('id')
    .limit(7);
  if (playersErr) throw playersErr;
  if (!players || players.length < 7) {
    throw new Error('E2E fixture needs at least 7 rows in `players` — seed the target database first.');
  }
  const playerIds = players.map((p) => (p as { id: number }).id);

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .insert({
      name: `E2E ${Date.now()} Regular Season`,
      status: 'UPCOMING',
      is_gauntlet: false,
      map_pool: maps.map((m) => (m as { name: string }).name),
      target_win_rounds: 13,
    })
    .select('id')
    .single();
  if (seasonErr) throw seasonErr;
  const seasonId = (season as { id: number }).id;

  const { error: rosterErr } = await supabase
    .from('season_players')
    .insert(playerIds.map((player_id) => ({ season_id: seasonId, player_id })));
  if (rosterErr) throw rosterErr;

  return { seasonId, playerIds };
}

/** Tears down everything a schedule-flow test could have produced for `seasonId`: materialized
 *  `matches`/`weeks` (present once `confirmSeasonScheduleDraft()` ran), any still-open draft rows
 *  (present if the test failed before confirming), the roster, and the season itself — in FK-safe
 *  order. Safe to call even if the test never got past `generate()`. */
export async function teardownSeason(seasonId: number): Promise<void> {
  const supabase = adminClient();

  const { data: weeks } = await supabase.from('weeks').select('id').eq('season_id', seasonId);
  const weekIds = (weeks ?? []).map((w) => (w as { id: number }).id);
  if (weekIds.length > 0) {
    await supabase.from('matches').delete().in('week_id', weekIds);
    await supabase.from('weeks').delete().in('id', weekIds);
  }

  const { data: draftWeeks } = await supabase
    .from('season_schedule_draft_weeks')
    .select('id')
    .eq('season_id', seasonId);
  const draftWeekIds = (draftWeeks ?? []).map((w) => (w as { id: number }).id);
  if (draftWeekIds.length > 0) {
    await supabase.from('season_schedule_draft_matches').delete().in('draft_week_id', draftWeekIds);
    await supabase.from('season_schedule_draft_weeks').delete().in('id', draftWeekIds);
  }

  await supabase.from('season_players').delete().eq('season_id', seasonId);
  await supabase.from('seasons').delete().eq('id', seasonId);
}
