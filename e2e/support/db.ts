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

/** Fetches the first `mapCount` map names and `playerCount` player ids in one round trip each (run
 *  in parallel, since neither read depends on the other), throwing if the target database's
 *  `seed.sql` baseline doesn't cover what a fixture needs — the shared shape both
 *  `seedSchedulableSeason()` and `seedPlayedMatchWithSabremetrics()` fetch before inserting
 *  anything of their own. */
async function fetchMapsAndPlayers(
  supabase: ReturnType<typeof adminClient>,
  mapCount: number,
  playerCount: number,
): Promise<{ mapNames: string[]; playerIds: number[] }> {
  const [{ data: maps, error: mapsErr }, { data: players, error: playersErr }] = await Promise.all([
    supabase.from('maps').select('name').limit(mapCount),
    supabase.from('players').select('id').order('id').limit(playerCount),
  ]);
  if (mapsErr) throw mapsErr;
  if (!maps || maps.length < mapCount) {
    throw new Error(`E2E fixture needs at least ${mapCount} rows in \`maps\` — seed the target database first.`);
  }
  if (playersErr) throw playersErr;
  if (!players || players.length < playerCount) {
    throw new Error(`E2E fixture needs at least ${playerCount} rows in \`players\` — seed the target database first.`);
  }
  return {
    mapNames: maps.map((m) => (m as { name: string }).name),
    playerIds: players.map((p) => (p as { id: number }).id),
  };
}

/** A regular (non-gauntlet) season with a 7-player roster — the same roster size already exercised
 *  by `season-schedule-draft-engine.test.ts`'s `buildRosterSchedule()` coverage, so `generate()` is
 *  known to produce a complete draft without a doubleheader-policy conflict. Named with an `E2E `
 *  prefix and a timestamp so a season left behind by an interrupted run is easy to spot and hand-clean
 *  in the Supabase dashboard. */
export async function seedSchedulableSeason(): Promise<TestSeason> {
  const supabase = adminClient();
  const { mapNames, playerIds } = await fetchMapsAndPlayers(supabase, 5, 7);

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .insert({
      name: `E2E ${Date.now()} Regular Season`,
      status: 'UPCOMING',
      is_gauntlet: false,
      map_pool: mapNames,
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

  const { data: weeks, error: weeksErr } = await supabase.from('weeks').select('id').eq('season_id', seasonId);
  if (weeksErr) throw weeksErr;
  const weekIds = (weeks ?? []).map((w) => (w as { id: number }).id);
  if (weekIds.length > 0) {
    const { error: matchesErr } = await supabase.from('matches').delete().in('week_id', weekIds);
    if (matchesErr) throw matchesErr;
    const { error: weekDeleteErr } = await supabase.from('weeks').delete().in('id', weekIds);
    if (weekDeleteErr) throw weekDeleteErr;
  }

  const { data: draftWeeks, error: draftWeeksErr } = await supabase
    .from('season_schedule_draft_weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (draftWeeksErr) throw draftWeeksErr;
  const draftWeekIds = (draftWeeks ?? []).map((w) => (w as { id: number }).id);
  if (draftWeekIds.length > 0) {
    const { error: draftMatchesErr } = await supabase.from('season_schedule_draft_matches').delete().in('draft_week_id', draftWeekIds);
    if (draftMatchesErr) throw draftMatchesErr;
    const { error: draftWeekDeleteErr } = await supabase.from('season_schedule_draft_weeks').delete().in('id', draftWeekIds);
    if (draftWeekDeleteErr) throw draftWeekDeleteErr;
  }

  // The roster can only change while the season is UPCOMING (the `season_players_upcoming_only`
  // trigger), and confirming a schedule makes it ACTIVE — so move it back before removing the roster.
  const { error: statusErr } = await supabase.from('seasons').update({ status: 'UPCOMING' }).eq('id', seasonId);
  if (statusErr) throw statusErr;
  const { error: rosterErr } = await supabase.from('season_players').delete().eq('season_id', seasonId);
  if (rosterErr) throw rosterErr;
  const { error: seasonErr } = await supabase.from('seasons').delete().eq('id', seasonId);
  if (seasonErr) throw seasonErr;
}

export interface TestMatch {
  seasonId: number;
  weekId: number;
  matchId: number;
  /** Rostered player ids, shirts first (2) then skins (2) — the same order `player_match_stats`
   *  was inserted in. */
  playerIds: number[];
}

export interface PlayedMatchOptions {
  /** The season's lifecycle status: `ACTIVE` (the default) is a running season, `ARCHIVED` a
   *  finished one — the home page's between-seasons state has only the latter. */
  status?: 'ACTIVE' | 'ARCHIVED';
}

/** A played, single-week regular season with one fully-scored 2v2 match, its `player_match_stats`
 *  roster, and the `player_match_sabremetrics`/`match_kills` rows a played match's demo-parse
 *  pipeline would have produced — enough for the match page's Advanced Stats tab
 *  (`SabremetricsLeaderboardView`, gated on `getMatchSabremetrics()` returning rows) to actually
 *  render during a test, the exact tab issue #480 exists to catch a missing page-level provider
 *  under. */
export async function seedPlayedMatchWithSabremetrics(options: PlayedMatchOptions = {}): Promise<TestMatch> {
  const { status = 'ACTIVE' } = options;
  const supabase = adminClient();
  const { mapNames, playerIds } = await fetchMapsAndPlayers(supabase, 1, 4);
  const [map] = mapNames;
  const [shirts1, shirts2, skins1, skins2] = playerIds;

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .insert({
      name: `E2E ${Date.now()} Smoke Season`,
      status,
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

  // Scoreline the roster's rounds_played/rounds_won below are derived from, so the two stay in sync.
  const ROUNDS_PLAYED = 22;
  const SHIRTS_ROUNDS_WON = 13;
  const SKINS_ROUNDS_WON = ROUNDS_PLAYED - SHIRTS_ROUNDS_WON;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      week_id: weekId,
      match_number: 1,
      final_score: `${SHIRTS_ROUNDS_WON}-${SKINS_ROUNDS_WON}`,
      skins_pick: map,
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
      { match_id: matchId, player_id: shirts1, faction: 'SHIRTS', kills: 20, assists: 3, deaths: 15, adr: 86, damage: 1881, rounds_played: ROUNDS_PLAYED, rounds_won: SHIRTS_ROUNDS_WON, is_win: true },
      { match_id: matchId, player_id: shirts2, faction: 'SHIRTS', kills: 18, assists: 5, deaths: 16, adr: 78, damage: 1720, rounds_played: ROUNDS_PLAYED, rounds_won: SHIRTS_ROUNDS_WON, is_win: true },
      { match_id: matchId, player_id: skins1, faction: 'SKINS', kills: 14, assists: 4, deaths: 19, adr: 65, damage: 1430, rounds_played: ROUNDS_PLAYED, rounds_won: SKINS_ROUNDS_WON, is_win: false },
      { match_id: matchId, player_id: skins2, faction: 'SKINS', kills: 12, assists: 6, deaths: 20, adr: 60, damage: 1322, rounds_played: ROUNDS_PLAYED, rounds_won: SKINS_ROUNDS_WON, is_win: false },
    ])
    .select('id, player_id, faction');
  if (statsErr) throw statsErr;
  const stats = statRows as { id: number; player_id: number; faction: 'SHIRTS' | 'SKINS' }[];
  const shirtsStatIds = stats.filter((s) => s.faction === 'SHIRTS').map((s) => s.id);
  const skinsStatIds = stats.filter((s) => s.faction === 'SKINS').map((s) => s.id);

  // Independent of each other (both only need `stats`' ids, just inserted above) — run together.
  const [{ error: sabErr }, { error: killsErr }] = await Promise.all([
    supabase.from('player_match_sabremetrics').insert(stats.map((s) => ({ player_match_stats_id: s.id }))),
    supabase.from('match_kills').insert([
      { match_id: matchId, round_number: 1, attacker_player_match_stats_id: shirtsStatIds[0], victim_player_match_stats_id: skinsStatIds[0], weapon: 'ak47', headshot: true, tick: 1000 },
      { match_id: matchId, round_number: 2, attacker_player_match_stats_id: skinsStatIds[1], victim_player_match_stats_id: shirtsStatIds[1], weapon: 'usp_silencer', headshot: false, tick: 2000 },
    ]),
  ]);
  if (sabErr) throw sabErr;
  if (killsErr) throw killsErr;

  return { seasonId, weekId, matchId, playerIds: [shirts1, shirts2, skins1, skins2] };
}

/** Tears down everything `seedPlayedMatchWithSabremetrics()` created, in FK-safe order. Checks
 *  every delete's own `{ error }` rather than discarding it — a silently-failed teardown would
 *  leave orphaned `E2E `-prefixed rows behind with no signal, the exact failure mode
 *  `AGENTS.md`'s "Never swallow a write's outcome" rule calls out for the Supabase JS client. */
export async function teardownMatch(fixture: TestMatch): Promise<void> {
  const supabase = adminClient();

  // Independent of each other — neither reads the other's result — so they run together; both
  // must finish before the `player_match_stats` delete below for FK safety.
  const [{ error: killsErr }, { data: statRows, error: statSelectErr }] = await Promise.all([
    supabase.from('match_kills').delete().eq('match_id', fixture.matchId),
    supabase.from('player_match_stats').select('id').eq('match_id', fixture.matchId),
  ]);
  if (killsErr) throw killsErr;
  if (statSelectErr) throw statSelectErr;

  const statIds = (statRows ?? []).map((s) => (s as { id: number }).id);
  if (statIds.length > 0) {
    const { error: sabErr } = await supabase
      .from('player_match_sabremetrics')
      .delete()
      .in('player_match_stats_id', statIds);
    if (sabErr) throw sabErr;
  }

  const { error: statsErr } = await supabase.from('player_match_stats').delete().eq('match_id', fixture.matchId);
  if (statsErr) throw statsErr;
  const { error: matchErr } = await supabase.from('matches').delete().eq('id', fixture.matchId);
  if (matchErr) throw matchErr;
  const { error: weekErr } = await supabase.from('weeks').delete().eq('id', fixture.weekId);
  if (weekErr) throw weekErr;
  const { error: seasonErr } = await supabase.from('seasons').delete().eq('id', fixture.seasonId);
  if (seasonErr) throw seasonErr;
}

export interface TestGauntlet {
  /** The paired regular season — the hub every stage page's URL is built from. */
  hubSeasonId: number;
  gauntletSeasonId: number;
  /** The number both season names carry (`Season <n>` / `Season <n> Gauntlet`); the pages title the
   *  pair `Season <n>`. */
  seasonNumber: number;
  /** The regular season's week 1 (one played match). */
  hubWeekId: number;
  hubMatchId: number;
  /** `weeks.id` of gauntlet round 1 (a gauntlet round is a `weeks` row owned by the gauntlet). */
  roundOneWeekId: number;
  /** Round 1's two groups (pod ids) and the final in round 2 (no games scheduled yet). */
  eliminationPodId: number;
  wildcardPodId: number;
  finalPodId: number;
  /** Both games of each round-1 group, in game order. */
  eliminationMatchIds: number[];
  wildcardMatchIds: number[];
  /** Display names by seed: seeds 1-4 are the elimination group, seeds 5-8 the wildcard group. */
  playerNamesBySeed: string[];
  /** The extra eighth player `seedGauntletWithPods()` adds; `teardownGauntlet()` removes it. */
  extraPlayerId: number;
}

/** Inserts one played 2v2 match's `player_match_stats` rows. Stats are uniform and derived from the
 *  scoreline — enough for scorecards and match cards to render, not a model of real play. */
async function insertPlayedMatchStats(
  supabase: ReturnType<typeof adminClient>,
  matchId: number,
  shirts: number[],
  skins: number[],
  shirtsRoundsWon: number,
  skinsRoundsWon: number,
): Promise<void> {
  const roundsPlayed = shirtsRoundsWon + skinsRoundsWon;
  const shirtsWon = shirtsRoundsWon > skinsRoundsWon;
  const row = (playerId: number, faction: 'SHIRTS' | 'SKINS') => {
    const won = faction === 'SHIRTS' ? shirtsWon : !shirtsWon;
    const adr = won ? 80 : 62;
    return {
      match_id: matchId,
      player_id: playerId,
      faction,
      kills: won ? 16 : 11,
      assists: 3,
      deaths: won ? 12 : 16,
      adr,
      damage: adr * roundsPlayed,
      rounds_played: roundsPlayed,
      rounds_won: faction === 'SHIRTS' ? shirtsRoundsWon : skinsRoundsWon,
      is_win: won,
    };
  };
  const { error } = await supabase
    .from('player_match_stats')
    .insert([...shirts.map((id) => row(id, 'SHIRTS')), ...skins.map((id) => row(id, 'SKINS'))]);
  if (error) throw error;
}

/** A paired regular season and gauntlet (`Season <n>` / `Season <n> Gauntlet`, paired by the number in
 *  the name) shaped like a real bracket:
 *
 *  - regular season: week 1 with one played match;
 *  - gauntlet round 1: two played groups of four players — group 1 an elimination pod (only the
 *    player who wins both games advances), group 2 a wildcard pod (everyone with a win advances) —
 *    each with two games on a shared roster re-split between games;
 *  - gauntlet round 2: the final, not yet scheduled (no `weeks` row, no games), its four slots fed by
 *    round 1's two groups (one from the elimination group, three from the wildcard group).
 *
 *  Needs eight players, one more than `seed.sql` provides, so it adds one `E2E ` player that
 *  `teardownGauntlet()` removes. */
export async function seedGauntletWithPods(): Promise<TestGauntlet> {
  const supabase = adminClient();
  const { mapNames, playerIds: seededIds } = await fetchMapsAndPlayers(supabase, 1, 7);
  const [map] = mapNames;
  const stamp = Date.now();
  // Offset from the small numbers real seasons use, so the pair never shares a number with other data.
  const seasonNumber = 1000 + (stamp % 8000);

  const { data: extraPlayer, error: extraErr } = await supabase
    .from('players')
    .insert({ name: `E2E ${stamp} Eighth` })
    .select('id, name')
    .single();
  if (extraErr) throw extraErr;
  const extra = extraPlayer as { id: number; name: string };
  const playerIds = [...seededIds, extra.id];

  const { data: names, error: namesErr } = await supabase.from('players').select('id, name').in('id', playerIds);
  if (namesErr) throw namesErr;
  const nameById = new Map((names as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const playerNamesBySeed = playerIds.map((id) => nameById.get(id) ?? `#${id}`);

  const { data: seasonRows, error: seasonErr } = await supabase
    .from('seasons')
    .insert([
      { name: `E2E ${stamp} Season ${seasonNumber}`, status: 'ARCHIVED', is_gauntlet: false, map_pool: [map], target_win_rounds: 13 },
      { name: `E2E ${stamp} Season ${seasonNumber} Gauntlet`, status: 'ACTIVE', is_gauntlet: true, map_pool: [map], target_win_rounds: 13 },
    ])
    .select('id, is_gauntlet');
  if (seasonErr) throw seasonErr;
  const seasons = seasonRows as { id: number; is_gauntlet: boolean }[];
  const hubSeasonId = seasons.find((s) => !s.is_gauntlet)!.id;
  const gauntletSeasonId = seasons.find((s) => s.is_gauntlet)!.id;

  const { data: weekRows, error: weekErr } = await supabase
    .from('weeks')
    .insert([
      { season_id: hubSeasonId, week_number: 1 },
      { season_id: gauntletSeasonId, week_number: 1 },
    ])
    .select('id, season_id');
  if (weekErr) throw weekErr;
  const weeks = weekRows as { id: number; season_id: number }[];
  const hubWeekId = weeks.find((w) => w.season_id === hubSeasonId)!.id;
  const roundOneWeekId = weeks.find((w) => w.season_id === gauntletSeasonId)!.id;

  // Gauntlet games are all playoff games.
  const matchSpecs = [
    { week_id: hubWeekId, match_number: 1, final_score: '13-9', is_playoff_game: false },
    { week_id: roundOneWeekId, match_number: 1, final_score: '13-9', is_playoff_game: true },
    { week_id: roundOneWeekId, match_number: 2, final_score: '13-7', is_playoff_game: true },
    { week_id: roundOneWeekId, match_number: 3, final_score: '13-10', is_playoff_game: true },
    { week_id: roundOneWeekId, match_number: 4, final_score: '13-6', is_playoff_game: true },
  ].map((m) => ({ ...m, skins_pick: map, shirts_pick: map, skins_starting_side: 'CT' }));
  const { data: matchRows, error: matchErr } = await supabase.from('matches').insert(matchSpecs).select('id, week_id, match_number');
  if (matchErr) throw matchErr;
  const matches = matchRows as { id: number; week_id: number; match_number: number }[];
  const matchId = (weekId: number, matchNumber: number) =>
    matches.find((m) => m.week_id === weekId && m.match_number === matchNumber)!.id;
  const hubMatchId = matchId(hubWeekId, 1);
  const eliminationMatchIds = [matchId(roundOneWeekId, 1), matchId(roundOneWeekId, 2)];
  const wildcardMatchIds = [matchId(roundOneWeekId, 3), matchId(roundOneWeekId, 4)];

  // Each group: game 1 is (a,b) vs (c,d), game 2 is (a,c) vs (b,d), shirts winning both — so `a` wins
  // twice, `b` and `c` once, `d` never.
  const [s1, s2, s3, s4, s5, s6, s7, s8] = playerIds;
  await Promise.all([
    insertPlayedMatchStats(supabase, hubMatchId, [s1, s2], [s3, s4], 13, 9),
    insertPlayedMatchStats(supabase, eliminationMatchIds[0], [s1, s2], [s3, s4], 13, 9),
    insertPlayedMatchStats(supabase, eliminationMatchIds[1], [s1, s3], [s2, s4], 13, 7),
    insertPlayedMatchStats(supabase, wildcardMatchIds[0], [s5, s6], [s7, s8], 13, 10),
    insertPlayedMatchStats(supabase, wildcardMatchIds[1], [s5, s7], [s6, s8], 13, 6),
  ]);

  const { data: podRows, error: podErr } = await supabase
    .from('gauntlet_pods')
    .insert([
      { season_id: gauntletSeasonId, round_number: 1, pod_index: 0, advance_rule: 'single', is_final: false, week_id: roundOneWeekId, match1_id: eliminationMatchIds[0], match2_id: eliminationMatchIds[1] },
      { season_id: gauntletSeasonId, round_number: 1, pod_index: 1, advance_rule: 'wildcard', is_final: false, week_id: roundOneWeekId, match1_id: wildcardMatchIds[0], match2_id: wildcardMatchIds[1] },
      { season_id: gauntletSeasonId, round_number: 2, pod_index: 0, advance_rule: 'single', is_final: true },
    ])
    .select('id, round_number, pod_index');
  if (podErr) throw podErr;
  const pods = podRows as { id: number; round_number: number; pod_index: number }[];
  const podId = (round: number, index: number) => pods.find((p) => p.round_number === round && p.pod_index === index)!.id;
  const eliminationPodId = podId(1, 0);
  const wildcardPodId = podId(1, 1);
  const finalPodId = podId(2, 0);

  const seedSlot = (pod_id: number, slot_index: number, seed: number) => ({
    pod_id,
    slot_index,
    source_kind: 'seed',
    source_seed: seed,
    player_id: playerIds[seed - 1],
  });
  const podSlot = (slot_index: number, source_pod_id: number) => ({
    pod_id: finalPodId,
    slot_index,
    source_kind: 'pod',
    source_pod_id,
    player_id: null,
  });
  const { error: slotErr } = await supabase.from('gauntlet_pod_slots').insert([
    ...[1, 2, 3, 4].map((seed, i) => seedSlot(eliminationPodId, i, seed)),
    ...[5, 6, 7, 8].map((seed, i) => seedSlot(wildcardPodId, i, seed)),
    podSlot(0, eliminationPodId),
    podSlot(1, wildcardPodId),
    podSlot(2, wildcardPodId),
    podSlot(3, wildcardPodId),
  ]);
  if (slotErr) throw slotErr;

  return {
    hubSeasonId,
    gauntletSeasonId,
    seasonNumber,
    hubWeekId,
    hubMatchId,
    roundOneWeekId,
    eliminationPodId,
    wildcardPodId,
    finalPodId,
    eliminationMatchIds,
    wildcardMatchIds,
    playerNamesBySeed,
    extraPlayerId: extra.id,
  };
}

/** Tears down everything `seedGauntletWithPods()` created, in FK-safe order (slots and pods hold
 *  references to matches and each other). Every delete's own `{ error }` is checked, per
 *  `AGENTS.md`'s "Never swallow a write's outcome". */
export async function teardownGauntlet(fixture: TestGauntlet): Promise<void> {
  const supabase = adminClient();
  const seasonIds = [fixture.hubSeasonId, fixture.gauntletSeasonId];

  const { data: podRows, error: podSelectErr } = await supabase
    .from('gauntlet_pods')
    .select('id')
    .eq('season_id', fixture.gauntletSeasonId);
  if (podSelectErr) throw podSelectErr;
  const podIds = (podRows ?? []).map((p) => (p as { id: number }).id);
  if (podIds.length > 0) {
    const { error: slotsErr } = await supabase.from('gauntlet_pod_slots').delete().in('pod_id', podIds);
    if (slotsErr) throw slotsErr;
    const { error: podsErr } = await supabase.from('gauntlet_pods').delete().in('id', podIds);
    if (podsErr) throw podsErr;
  }

  const { data: weekRows, error: weekSelectErr } = await supabase.from('weeks').select('id').in('season_id', seasonIds);
  if (weekSelectErr) throw weekSelectErr;
  const weekIds = (weekRows ?? []).map((w) => (w as { id: number }).id);
  if (weekIds.length > 0) {
    const { data: matchRows, error: matchSelectErr } = await supabase.from('matches').select('id').in('week_id', weekIds);
    if (matchSelectErr) throw matchSelectErr;
    const matchIds = (matchRows ?? []).map((m) => (m as { id: number }).id);
    if (matchIds.length > 0) {
      const { error: statsErr } = await supabase.from('player_match_stats').delete().in('match_id', matchIds);
      if (statsErr) throw statsErr;
      const { error: matchesErr } = await supabase.from('matches').delete().in('id', matchIds);
      if (matchesErr) throw matchesErr;
    }
    const { error: weeksErr } = await supabase.from('weeks').delete().in('id', weekIds);
    if (weeksErr) throw weeksErr;
  }

  const { error: seasonsErr } = await supabase.from('seasons').delete().in('id', seasonIds);
  if (seasonsErr) throw seasonsErr;
  const { error: playerErr } = await supabase.from('players').delete().eq('id', fixture.extraPlayerId);
  if (playerErr) throw playerErr;
}

export interface ScrimSignupSeed {
  playerId: number;
  commitment?: 'definite' | 'maybe';
  checkedIn?: boolean;
}

/** A scrim night starting `start` — milliseconds from now (negative for one already running or
 *  over), or an ISO instant — with `signups`, written straight to `scrim_nights`/`scrim_signups` — bypassing the app's quarter-hour
 *  and overlap rules, so a test can place a night exactly where it needs one (e.g. ten minutes out,
 *  with check-in open). Returns the night id. */
export async function seedScrimNight(start: number | string, signups: ScrimSignupSeed[] = []): Promise<number> {
  const supabase = adminClient();
  const { data: night, error: nightErr } = await supabase
    .from('scrim_nights')
    .insert({ starts_at: typeof start === 'string' ? start : new Date(Date.now() + start).toISOString() })
    .select('id')
    .single();
  if (nightErr) throw nightErr;
  const nightId = (night as { id: number }).id;
  if (signups.length > 0) {
    const { error } = await supabase.from('scrim_signups').insert(
      signups.map((s) => ({
        night_id: nightId,
        player_id: s.playerId,
        commitment: s.commitment ?? 'definite',
        checked_in_at: s.checkedIn ? new Date().toISOString() : null,
      })),
    );
    if (error) throw error;
  }
  return nightId;
}

/** A played scrim match on `nightId` — 13-7, `playerIds` shirts first (2) then skins (2) — so the
 *  night has results (Past nights, the leaderboard). */
export async function seedScoredScrimMatch(nightId: number, playerIds: number[], map = 'foroglio'): Promise<number> {
  const supabase = adminClient();
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({ scrim_night_id: nightId, match_number: 1, shirts_pick: map, scrim_side_choice: 'knife', final_score: '13-7' })
    .select('id')
    .single();
  if (matchErr) throw matchErr;
  const matchId = (match as { id: number }).id;
  const line = (playerId: number, faction: 'SHIRTS' | 'SKINS') => {
    const won = faction === 'SHIRTS';
    return { match_id: matchId, player_id: playerId, faction, kills: won ? 18 : 10, assists: 2, deaths: won ? 10 : 18, adr: won ? 90 : 60, damage: won ? 1800 : 1200, rounds_played: 20, rounds_won: won ? 13 : 7, is_win: won };
  };
  const [a, b, c, d] = playerIds;
  const { error } = await supabase.from('player_match_stats').insert([line(a, 'SHIRTS'), line(b, 'SHIRTS'), line(c, 'SKINS'), line(d, 'SKINS')]);
  if (error) throw error;
  return matchId;
}

/** An unscored scrim match on `nightId` — match `matchNumber`, `playerIds` shirts first (2) then skins
 *  (2) — with `serverState` as its `match_server_state` (none for `null`, a match never started). */
export async function seedUnscoredScrimMatch(nightId: number, matchNumber: number, playerIds: number[], serverState: string | null, map = 'foroglio'): Promise<number> {
  const supabase = adminClient();
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({ scrim_night_id: nightId, match_number: matchNumber, shirts_pick: map, scrim_side_choice: 'knife' })
    .select('id')
    .single();
  if (matchErr) throw matchErr;
  const matchId = (match as { id: number }).id;
  const [a, b, c, d] = playerIds;
  const lineup = [[a, 'SHIRTS'], [b, 'SHIRTS'], [c, 'SKINS'], [d, 'SKINS']] as const;
  const { error } = await supabase.from('player_match_stats').insert(lineup.map(([playerId, faction]) => ({ match_id: matchId, player_id: playerId, faction })));
  if (error) throw error;
  if (serverState) {
    const { error: stateErr } = await supabase.from('match_server_state').insert({ match_id: matchId, server_state: serverState });
    if (stateErr) throw stateErr;
  }
  return matchId;
}

/** The scrim nights starting at `startsAt` exactly — how a test finds a night the UI just created. */
export async function scrimNightIdsStartingAt(startsAt: string): Promise<number[]> {
  const { data, error } = await adminClient().from('scrim_nights').select('id').eq('starts_at', startsAt);
  if (error) throw error;
  return (data ?? []).map((n) => (n as { id: number }).id);
}

/** The scrim matches of `nightId` in play order, with their lineups' player ids. */
export async function scrimMatchesOf(nightId: number): Promise<{ id: number; match_number: number; scrim_side_choice: string; players: number[] }[]> {
  const { data, error } = await adminClient()
    .from('matches')
    .select('id, match_number, scrim_side_choice, player_match_stats(player_id)')
    .eq('scrim_night_id', nightId)
    .order('match_number');
  if (error) throw error;
  return ((data ?? []) as { id: number; match_number: number; scrim_side_choice: string; player_match_stats: { player_id: number }[] }[]).map((m) => ({
    id: m.id,
    match_number: m.match_number,
    scrim_side_choice: m.scrim_side_choice,
    players: m.player_match_stats.map((p) => p.player_id),
  }));
}

/** Whether night `nightId` still exists. */
export async function scrimNightExists(nightId: number): Promise<boolean> {
  const { data, error } = await adminClient().from('scrim_nights').select('id').eq('id', nightId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Gives the seeded `maps` rows Workshop links, so a scrim match has maps to start on
 *  (`getMapsForWorkshopPicker()` lists only maps with one). Undone by `clearMapWorkshopUrls()`. */
export async function setMapWorkshopUrls(): Promise<void> {
  const supabase = adminClient();
  const { data, error } = await supabase.from('maps').select('id').order('id');
  if (error) throw error;
  for (const [i, m] of ((data ?? []) as { id: number }[]).entries()) {
    const { error: updateErr } = await supabase
      .from('maps')
      .update({ workshop_url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${3070000000 + i}` })
      .eq('id', m.id);
    if (updateErr) throw updateErr;
  }
}

export async function clearMapWorkshopUrls(): Promise<void> {
  const { error } = await adminClient().from('maps').update({ workshop_url: null }).not('id', 'is', null);
  if (error) throw error;
}

/** Deletes every scrim night — their signups and matches go with them (`on delete cascade`). The
 *  local database holds only test data, so scrim specs start each test from no nights at all. */
export async function teardownScrims(): Promise<void> {
  const { error } = await adminClient().from('scrim_nights').delete().not('id', 'is', null);
  if (error) throw error;
}
