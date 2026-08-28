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

export interface TestMatch {
  seasonId: number;
  weekId: number;
  matchId: number;
  /** Rostered player ids, shirts first (2) then skins (2) — the same order `player_match_stats`
   *  was inserted in. */
  playerIds: number[];
}

/** A played, single-week regular season with one fully-scored 2v2 match, its `player_match_stats`
 *  roster, and the `player_match_sabremetrics`/`match_kills` rows a played match's demo-parse
 *  pipeline would have produced — enough for the match page's Advanced Stats tab
 *  (`SabremetricsLeaderboardView`, gated on `getMatchSabremetrics()` returning rows) to actually
 *  render during a test, the exact tab issue #480 exists to catch a missing page-level provider
 *  under. */
export async function seedPlayedMatchWithSabremetrics(): Promise<TestMatch> {
  const supabase = adminClient();

  const { data: maps, error: mapsErr } = await supabase.from('maps').select('name').limit(1);
  if (mapsErr) throw mapsErr;
  if (!maps || maps.length === 0) {
    throw new Error('E2E fixture needs at least 1 row in `maps` — seed the target database first.');
  }
  const map = (maps[0] as { name: string }).name;

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id')
    .order('id')
    .limit(4);
  if (playersErr) throw playersErr;
  if (!players || players.length < 4) {
    throw new Error('E2E fixture needs at least 4 rows in `players` — seed the target database first.');
  }
  const [shirts1, shirts2, skins1, skins2] = players.map((p) => (p as { id: number }).id);

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .insert({
      name: `E2E ${Date.now()} Smoke Season`,
      status: 'ACTIVE',
      is_gauntlet: false,
      map_pool: [map],
      target_win_rounds: 13,
    })
    .select('id')
    .single();
  if (seasonErr) throw seasonErr;
  const seasonId = (season as { id: number }).id;

  const { data: week, error: weekErr } = await supabase
    .from('weeks')
    .insert({ season_id: seasonId, week_number: 1 })
    .select('id')
    .single();
  if (weekErr) throw weekErr;
  const weekId = (week as { id: number }).id;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      week_id: weekId,
      match_number: 1,
      final_score: '13-9',
      picked_map: map,
      shirts_pick: map,
      skins_starting_side: 'CT',
      is_playoff_game: false,
    })
    .select('id')
    .single();
  if (matchErr) throw matchErr;
  const matchId = (match as { id: number }).id;

  const { data: statRows, error: statsErr } = await supabase
    .from('player_match_stats')
    .insert([
      { match_id: matchId, player_id: shirts1, faction: 'SHIRTS', kills: 20, assists: 3, deaths: 15, adr: 86, damage: 1881, rounds_played: 22, rounds_won: 13, is_win: true },
      { match_id: matchId, player_id: shirts2, faction: 'SHIRTS', kills: 18, assists: 5, deaths: 16, adr: 78, damage: 1720, rounds_played: 22, rounds_won: 13, is_win: true },
      { match_id: matchId, player_id: skins1, faction: 'SKINS', kills: 14, assists: 4, deaths: 19, adr: 65, damage: 1430, rounds_played: 22, rounds_won: 9, is_win: false },
      { match_id: matchId, player_id: skins2, faction: 'SKINS', kills: 12, assists: 6, deaths: 20, adr: 60, damage: 1322, rounds_played: 22, rounds_won: 9, is_win: false },
    ])
    .select('id, player_id, faction');
  if (statsErr) throw statsErr;
  const stats = statRows as { id: number; player_id: number; faction: 'SHIRTS' | 'SKINS' }[];
  const shirtsStatIds = stats.filter((s) => s.faction === 'SHIRTS').map((s) => s.id);
  const skinsStatIds = stats.filter((s) => s.faction === 'SKINS').map((s) => s.id);

  const { error: sabErr } = await supabase
    .from('player_match_sabremetrics')
    .insert(stats.map((s) => ({ player_match_stats_id: s.id })));
  if (sabErr) throw sabErr;

  const { error: killsErr } = await supabase.from('match_kills').insert([
    { match_id: matchId, round_number: 1, attacker_player_match_stats_id: shirtsStatIds[0], victim_player_match_stats_id: skinsStatIds[0], weapon: 'ak47', headshot: true, tick: 1000 },
    { match_id: matchId, round_number: 2, attacker_player_match_stats_id: skinsStatIds[1], victim_player_match_stats_id: shirtsStatIds[1], weapon: 'usp_silencer', headshot: false, tick: 2000 },
  ]);
  if (killsErr) throw killsErr;

  return { seasonId, weekId, matchId, playerIds: [shirts1, shirts2, skins1, skins2] };
}

/** Tears down everything `seedPlayedMatchWithSabremetrics()` created, in FK-safe order. */
export async function teardownMatch(fixture: TestMatch): Promise<void> {
  const supabase = adminClient();

  await supabase.from('match_kills').delete().eq('match_id', fixture.matchId);

  const { data: statRows } = await supabase
    .from('player_match_stats')
    .select('id')
    .eq('match_id', fixture.matchId);
  const statIds = (statRows ?? []).map((s) => (s as { id: number }).id);
  if (statIds.length > 0) {
    await supabase.from('player_match_sabremetrics').delete().in('player_match_stats_id', statIds);
  }

  await supabase.from('player_match_stats').delete().eq('match_id', fixture.matchId);
  await supabase.from('matches').delete().eq('id', fixture.matchId);
  await supabase.from('weeks').delete().eq('id', fixture.weekId);
  await supabase.from('seasons').delete().eq('id', fixture.seasonId);
}
