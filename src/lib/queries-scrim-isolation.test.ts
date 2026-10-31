/**
 * Scrim matches never reach league stats. A scrim match is a `matches` row with `scrim_night_id` set
 * and no `week_id`, carrying the same per-match fact rows a league match does (stats, sabremetrics,
 * kills, rounds, utility, weapon and economy). This adds one — a full copy of fixture match 100 — to
 * the shared fixture league and asserts every league-facing read returns exactly what it does
 * without it. A new league read that reaches matches without going through a week fails here.
 *
 * Run:  npx vitest run src/lib/queries-scrim-isolation.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb, type Row } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { test, report } from './test-support/miniTest';
import {
  getAllLeaderboards,
  getCareerLeaderboard,
  getSeasonLeaderboard,
  getSeasonForm,
  getStatisticsDetail,
  getH2HData,
  getPlayer,
  getPlayerRecent,
  getPlayerSummary,
  getMapIndex,
  getMapDetail,
  getAllPlayedMatchIds,
  getAllMatchesWithPickBan,
  getMatchIdsForMap,
  getAllSabremetrics,
  getSabremetricSeasonTotals,
  getAllMatchKills,
  getAllWeaponClassStats,
  getAllEconomyStats,
  getAllMatchRounds,
  getAllSeasonMedalists,
  getGauntletStats,
  getAllGauntletSummaries,
  getRegularSeasonStatsView,
  getGauntletSeasonStatsView,
  getSeasonSchedule,
  getSeasonPlayedPlayers,
  getSeasonParticipants,
  getMyStats,
  getAllUtilityThrows,
} from './queries';

const SOURCE_MATCH_ID = 100;
const SCRIM_MATCH_ID = 9100;
/** Added to every cloned row's own `id`, keeping clones clear of fixture ids. */
const ID_OFFSET = 900_000;

/** The fixture league plus a scrim copy of `SOURCE_MATCH_ID`: every row keyed to that match is cloned
 *  onto `SCRIM_MATCH_ID`, with `*player_match_stats_id` references remapped to the cloned stat rows.
 *  EHOG history and the leaderboard view's fixture rows aren't cloned — neither ever includes a scrim. */
function withScrimMatch(): FakeDb {
  const db = buildFakeDb();
  const source = db.matches.find((m) => m.id === SOURCE_MATCH_ID);
  assert.ok(source, 'fixture match 100 exists');
  db.scrim_nights = [{ id: 1, night_date: '2026-01-08', cancelled: false }];
  db.matches = [...db.matches, { ...source, id: SCRIM_MATCH_ID, week_id: null, scrim_night_id: 1, is_feature_match: false }];

  const pmsIds = new Map<number, number>();
  for (const r of db.player_match_stats) {
    if (r.match_id === SOURCE_MATCH_ID) pmsIds.set(r.id as number, (r.id as number) + ID_OFFSET);
  }
  const skip = new Set(['matches', 'player_rating_history', 'player_current_ratings', 'player_season_leaderboard']);
  for (const [table, rows] of Object.entries(db)) {
    if (skip.has(table)) continue;
    const clones: Row[] = [];
    for (const r of rows) {
      const viaMatch = r.match_id === SOURCE_MATCH_ID;
      const viaPms = Object.entries(r).some(([k, v]) => k.endsWith('player_match_stats_id') && pmsIds.has(v as number));
      if (!viaMatch && !viaPms) continue;
      const clone: Row = { ...r };
      if (viaMatch) clone.match_id = SCRIM_MATCH_ID;
      if (typeof r.id === 'number') clone.id = r.id + ID_OFFSET;
      for (const [k, v] of Object.entries(r)) {
        if (k.endsWith('player_match_stats_id') && pmsIds.has(v as number)) clone[k] = pmsIds.get(v as number);
      }
      clones.push(clone);
    }
    db[table] = [...rows, ...clones];
  }
  assert.ok(db.player_match_stats.some((r) => r.match_id === SCRIM_MATCH_ID), 'scrim stat rows were cloned');
  return db;
}

const CAREER = { filter: 'career', includeRegular: true, includeGauntlet: true } as const;

/** Every league-facing read, keyed by name. Each runs against whichever client is installed. */
const READS: Record<string, () => Promise<unknown>> = {
  getAllLeaderboards: () => getAllLeaderboards(),
  getCareerLeaderboard: () => getCareerLeaderboard(),
  'getSeasonLeaderboard(1)': () => getSeasonLeaderboard(1),
  'getSeasonForm(1)': () => getSeasonForm(1),
  getStatisticsDetail: () => getStatisticsDetail(),
  'getH2HData(career)': () => getH2HData(CAREER),
  'getH2HData(season 1)': () => getH2HData({ filter: 1, includeRegular: true, includeGauntlet: false }),
  'getPlayer(1)': () => getPlayer(1),
  'getPlayer(3)': () => getPlayer(3),
  'getPlayerRecent(1)': () => getPlayerRecent(1, 5),
  'getPlayerSummary(1)': () => getPlayerSummary(1),
  'getMyStats(1)': async () => getMyStats(1, await getH2HData(CAREER)),
  getMapIndex: () => getMapIndex(),
  "getMapDetail('foroglio')": () => getMapDetail('foroglio'),
  getAllPlayedMatchIds: () => getAllPlayedMatchIds(),
  getAllMatchesWithPickBan: () => getAllMatchesWithPickBan(),
  "getMatchIdsForMap('Foroglio')": () => getMatchIdsForMap('Foroglio'),
  getAllSabremetrics: () => getAllSabremetrics(),
  getSabremetricSeasonTotals: () => getSabremetricSeasonTotals(),
  getAllMatchKills: () => getAllMatchKills(),
  getAllWeaponClassStats: () => getAllWeaponClassStats(),
  getAllEconomyStats: () => getAllEconomyStats(),
  getAllMatchRounds: () => getAllMatchRounds(),
  getAllSeasonMedalists: () => getAllSeasonMedalists(),
  getGauntletStats: () => getGauntletStats(),
  getAllGauntletSummaries: () => getAllGauntletSummaries(),
  'getRegularSeasonStatsView(1)': () => getRegularSeasonStatsView(1),
  'getGauntletSeasonStatsView(2)': () => getGauntletSeasonStatsView(2),
  'getSeasonSchedule(1)': () => getSeasonSchedule(1),
  'getSeasonPlayedPlayers(1)': () => getSeasonPlayedPlayers(1),
  'getSeasonParticipants(1)': () => getSeasonParticipants(1),
};

async function readAll(db: FakeDb): Promise<Record<string, unknown>> {
  __setTestAdminClient(createFakeSupabaseClient(db));
  const out: Record<string, unknown> = {};
  for (const [name, read] of Object.entries(READS)) out[name] = await read();
  return out;
}

async function main() {
  const baseline = await readAll(buildFakeDb());
  const withScrim = await readAll(withScrimMatch());

  await test('control: an unscoped raw fact read does see the scrim rows', async () => {
    __setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));
    const before = (await getAllUtilityThrows()).length;
    __setTestAdminClient(createFakeSupabaseClient(withScrimMatch()));
    assert.ok((await getAllUtilityThrows()).length > before);
  });

  for (const name of Object.keys(READS)) {
    await test(`${name} ignores scrim matches`, () => {
      assert.deepEqual(withScrim[name], baseline[name]);
    });
  }

  report();
}

await main();

__setTestAdminClient(undefined);
