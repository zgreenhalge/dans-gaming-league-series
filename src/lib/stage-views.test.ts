/**
 * Tests for the week/round/group derivations (stage-views.ts) and their fetchers
 * (queries/groups.ts) against the shared fixture. Run: npx vitest run src/lib/stage-views.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

import { getWeekView, getFirstGauntletRound, getGauntletStageData, getWeekRow, getPodSeasonId, getStagePagePaths } from './queries';
import { deriveGroupPageView, deriveRoundView, deriveWeekView, stageStatus, type GauntletStageData } from './stage-views';
import { getSeasonSchedule, getSeasonWeekNav } from './queries';
import type { WeekWithMatches } from './queries';
import { hubIdsBySeason } from './queries';
import type { Season } from './types';
import type { BracketPod, GauntletMatch } from './queries/gauntlet';
import { test } from './test-support/miniTest';

test('stageStatus: complete / in-progress / upcoming', () => {
  assert.equal(stageStatus([]), 'upcoming');
  assert.equal(stageStatus([{ final_score: null }]), 'upcoming');
  assert.equal(stageStatus([{ final_score: '0-0' }]), 'upcoming');
  assert.equal(stageStatus([{ final_score: '13-9' }, { final_score: null }]), 'in-progress');
  assert.equal(stageStatus([{ final_score: '13-9' }, { final_score: '13-1' }]), 'complete');
});

test('getWeekView: scorecard, status and nav for the fixture season', async () => {
  const view = await getWeekView(1, 10);
  assert.ok(view);
  assert.equal(view.week.week_number, 1);
  assert.equal(view.status, 'in-progress', 'week 1 has a played match and an unplayed one');
  assert.equal(view.scorecard.length, 4);
  assert.deepEqual(view.scorecard.map((r) => r.rank), [1, 2, 3, 4]);
  assert.ok(view.scorecard.every((r) => r.movement === null), 'week 1 has no movement to show');
  assert.deepEqual(view.nav.map((i) => i.href), ['/seasons/1/weeks/10', '/seasons/1/weeks/11']);
  assert.deepEqual(view.nav.map((i) => i.current), [true, false]);
  assert.equal(await getWeekView(1, 9999), null);
});

test('getSeasonSchedule throughWeek and getSeasonWeekNav: full rosters to the week, a light listing of all', async () => {
  assert.deepEqual((await getSeasonSchedule(1, undefined, { throughWeek: 1 })).map((w) => w.week_number), [1]);
  assert.deepEqual((await getSeasonSchedule(1)).map((w) => w.week_number), [1, 2]);
  const nav = await getSeasonWeekNav(1);
  assert.deepEqual(nav.map((w) => w.week_number), [1, 2]);
  assert.deepEqual(Object.keys(nav[0].matches[0]), ['final_score']);
});

test('deriveWeekView: movement reads only the weeks through this one, and is absent in week 1', () => {
  const stat = (player_id: number, is_win: boolean, rounds_won: number, damage: number) => ({
    player_id, player_name: `P${player_id}`, faction: 'SHIRTS' as const, kills: 0, assists: 0, deaths: 0, adr: damage / 22, damage, is_win, rounds_won, rounds_played: 22,
  });
  const match = (id: number, shirtsWin: boolean) => ({
    id, final_score: shirtsWin ? '13-9' : '9-13',
    shirts_stats: [stat(1, shirtsWin, shirtsWin ? 13 : 9, 1800), stat(2, shirtsWin, shirtsWin ? 13 : 9, 1500)],
    skins_stats: [stat(3, !shirtsWin, shirtsWin ? 9 : 13, 1700), stat(4, !shirtsWin, shirtsWin ? 9 : 13, 1400)],
  });
  const week = (id: number, n: number, shirtsWin: boolean) =>
    ({ id, season_id: 1, week_number: n, bye_player_id: null, bye_player_name: null, matches: [match(id * 10, shirtsWin)] }) as unknown as WeekWithMatches;
  const w1 = week(1, 1, true);
  const w2 = week(2, 2, false);
  const navWeeks = [w1, w2, { id: 3, week_number: 3, matches: [{ final_score: null }] }];

  const first = deriveWeekView(7, [w1], navWeeks, 1)!;
  assert.ok(first.scorecard.every((r) => r.movement === null));

  const second = deriveWeekView(7, [w1, w2], navWeeks, 2)!;
  const p3 = second.scorecard.find((r) => r.player_id === 3)!;
  assert.deepEqual(p3.movement, { before: 3, after: p3.movement!.after });
  assert.ok(p3.movement!.after < 3, 'a player who won week 2 moved up');
  assert.deepEqual(second.nav.map((i) => i.chip), ['1', '2', '3'], 'the strip lists weeks that are not loaded in full');
});

test('getFirstGauntletRound: the lowest round of the bracket, or null without one', async () => {
  assert.equal(await getFirstGauntletRound(2), 1);
  assert.equal(await getFirstGauntletRound(3), null);
});

test("deriveWeekView: the week's bye player is on the scorecard with nothing played, and their season rank can still move", () => {
  const stat = (player_id: number, is_win: boolean, rounds_won: number) => ({
    player_id, player_name: `P${player_id}`, faction: 'SHIRTS' as const, kills: 0, assists: 0, deaths: 0, adr: 60, damage: 1300, is_win, rounds_won, rounds_played: 22,
  });
  // Week 1: P5 and P6 win together (both 1-0, P5 ranked first). Week 2, P5 on a bye: P6 wins again and
  // overtakes P5 without P5 playing.
  const m = (id: number, winners: number[], losers: number[]) => ({
    id, final_score: '13-9', shirts_stats: winners.map((p) => stat(p, true, 13)), skins_stats: losers.map((p) => ({ ...stat(p, false, 9), faction: 'SKINS' as const })),
  });
  const w1 = { id: 1, season_id: 1, week_number: 1, bye_player_id: null, bye_player_name: null, matches: [m(10, [5, 6], [7, 8])] } as unknown as WeekWithMatches;
  const w2 = { id: 2, season_id: 1, week_number: 2, bye_player_id: 5, bye_player_name: 'P5', matches: [m(20, [6, 9], [7, 8])] } as unknown as WeekWithMatches;
  const navWeeks = [w1, w2];

  const second = deriveWeekView(7, [w1, w2], navWeeks, 2)!;
  const bye = second.scorecard.at(-1)!;
  assert.equal(bye.player_id, 5);
  assert.equal(bye.matches_played, 0);
  assert.equal(`${bye.wins}-${bye.losses}`, '0-0');
  assert.ok(bye.movement && bye.movement.before !== null, 'a bye player ranked before still gets a season movement');
  assert.ok(bye.movement!.after > bye.movement!.before!, "others' wins pushed them down");

  const first = deriveWeekView(7, [{ ...w1, bye_player_id: 5, bye_player_name: 'P5' } as WeekWithMatches], navWeeks, 1);
  assert.equal(first!.scorecard.length, 4, 'a bye player who already played the week is not added twice');
  const neverPlayed = deriveWeekView(7, [{ ...w2, bye_player_id: 99, bye_player_name: 'P99' } as WeekWithMatches], navWeeks, 2)!;
  assert.equal(neverPlayed.scorecard.at(-1)!.movement, null, 'a player with no season results yet has no rank to move');
});

test('getWeekRow / getPodSeasonId resolve ids to their season', async () => {
  assert.deepEqual(await getWeekRow(11), { id: 11, season_id: 1, week_number: 2 });
  assert.equal(await getWeekRow(9999), null);
  assert.equal(await getPodSeasonId(1000), 2);
  assert.equal(await getPodSeasonId(9999), null);
});

test('getGauntletStageData: rounds, bracket shape and week ids for the paired gauntlet', async () => {
  const data = await getGauntletStageData(2);
  assert.equal(data.rounds[0].round_number, 1);
  assert.deepEqual(data.bracketShape.map((p) => p.id), [1000]);
  const round = deriveRoundView(1, data, 1)!;
  assert.equal(round.groups.length, 1);
  assert.equal(round.groups[0].label, 'Final');
});

test('hubIdsBySeason: regular seasons are their own hub, a gauntlet maps to the first regular season with its number', () => {
  const season = (id: number, name: string, is_gauntlet: boolean) => ({ id, name, is_gauntlet }) as Season;
  const hubs = hubIdsBySeason([
    season(1, 'Season 5', false),
    season(2, 'Season 5 Gauntlet', true),
    season(3, 'Season 4 Gauntlet', true),
    season(4, 'Season 5', false),
  ]);
  assert.equal(hubs.get(1), 1);
  assert.equal(hubs.get(2), 1, 'paired by season number');
  assert.equal(hubs.get(3), 3, 'an unpaired gauntlet is its own hub');
  assert.equal(hubs.get(4), 4);
});

test('getStagePagePaths: weeks, rounds and groups, with gauntlets filed under their paired regular season', async () => {
  const paths = await getStagePagePaths();
  assert.ok(paths.includes('/seasons/1/weeks/10'));
  assert.ok(paths.includes('/seasons/1/rounds/1'), 'gauntlet 2 pairs with regular season 1');
  assert.ok(paths.includes('/seasons/1/groups/1000'));
  assert.ok(paths.includes('/seasons/4/rounds/1'), 'an unpaired gauntlet is its own hub');
});

// ── Synthetic two-round gauntlet ─────────────────────────────────────────────────────────────────

function gm(id: number, matchNumber: number, podIndex: number, rule: 'single' | 'wildcard', score: string | null, wins: number[], players: number[]): GauntletMatch {
  const [a, b, c, d] = players;
  const stat = (player_id: number, faction: 'SHIRTS' | 'SKINS') => ({
    player_id, player_name: `P${player_id}`, faction, kills: 5, assists: 1, deaths: 5, adr: 70, damage: 1500,
    is_win: wins.includes(player_id),
    rounds_won: 0, rounds_played: 0,
  });
  return {
    id, match_number: matchNumber, final_score: score, scheduled_at: null, picked_map: null, shirts_pick: null, skins_starting_side: null,
    is_feature_match: false, pod_index: podIndex, advance_rule: rule,
    shirts_stats: [stat(a, 'SHIRTS'), stat(b, 'SHIRTS')], skins_stats: [stat(c, 'SKINS'), stat(d, 'SKINS')],
  };
}

function pod(id: number, round: number, index: number, rule: 'single' | 'wildcard', isFinal: boolean, materialized: boolean, slots: [number | null, number | null][]): BracketPod {
  return {
    id, round_number: round, pod_index: index, advance_rule: rule, is_final: isFinal, played: false, materialized,
    slots: slots.map(([seed, player], i) => ({
      slot_index: i, source_kind: 'seed' as const, source_seed: seed, source_pod_id: null, player_id: player, player_name: player ? `P${player}` : null,
    })),
  };
}

// Round 1: one single-elimination pod, fully played — shirts [1,2] beat skins [3,4] in game 1, then
// [1,3] beat [2,4] in game 2, so player 1 went 2-0, players 2 and 3 1-1, player 4 0-2.
// Round 2: the final pod, not yet materialized.
function stage(): GauntletStageData {
  const g1 = gm(1, 1, 0, 'single', '13-9', [1, 2], [1, 2, 3, 4]);
  const g2 = gm(2, 2, 0, 'single', '13-7', [1, 3], [1, 3, 2, 4]);
  return {
    rounds: [{ round_number: 1, is_final_round: false, matches: [g1, g2] }],
    bracketShape: [
      pod(10, 1, 0, 'single', false, true, [[1, 1], [2, 2], [3, 3], [4, 4]]),
      pod(11, 2, 0, 'single', true, false, [[null, null], [null, null], [null, null], [null, null]]),
    ],
  };
}

test('deriveRoundView: groups, nav and an unscheduled later round', () => {
  const view = deriveRoundView(5, stage(), 1)!;
  assert.equal(view.roundNumber, 1);
  assert.equal(view.status, 'complete');
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].label, 'Group 1');
  assert.deepEqual(view.nav.map((i) => [i.chip, i.href, i.played]), [
    ['1', '/seasons/5/rounds/1', true],
    ['2', '/seasons/5/rounds/2', false],
  ]);
  assert.equal(deriveRoundView(5, stage(), 999), null);

  const pending = deriveRoundView(5, stage(), 2)!;
  assert.equal(pending.isFinal, true);
  assert.equal(pending.groups[0].matches.length, 0);
});

test('group scorecard: ranks by the canonical gauntlet order and marks who advances', () => {
  const view = deriveGroupPageView(5, stage(), 10)!;
  const rows = view.group.scorecard;
  assert.equal(rows[0].player_id, 1);
  assert.equal(rows[0].wins, 2);
  assert.deepEqual(rows.map((r) => r.outcome), ['advances', 'eliminated', 'eliminated', 'eliminated']);
  assert.deepEqual(rows.map((r) => r.seed), rows.map((r) => r.player_id), 'seed comes from the pod slots');
  assert.deepEqual(view.nav.map((i) => i.chip), ['Group 1']);
});

test('a round with several groups gets a group strip with the current one marked', () => {
  const data = stage();
  data.bracketShape.splice(1, 0, pod(12, 1, 1, 'single', false, false, [[5, 5], [6, 6], [7, 7], [8, 8]]));
  const view = deriveGroupPageView(5, data, 12)!;
  assert.deepEqual(view.nav.map((i) => [i.chip, i.href, i.current]), [
    ['Group 1', '/seasons/5/groups/10', false],
    ['Group 2', '/seasons/5/groups/12', true],
  ]);
});

test('an unmaterialized pod lists its resolved slots in seed order, unranked and pending', () => {
  const data = stage();
  data.bracketShape[1] = pod(11, 2, 0, 'single', true, false, [[3, 3], [1, 1], [2, 2], [4, 4]]);
  const view = deriveGroupPageView(5, data, 11)!;
  assert.equal(view.group.status, 'upcoming');
  assert.deepEqual(view.group.scorecard.map((r) => r.player_id), [1, 2, 3, 4]);
  assert.ok(view.group.scorecard.every((r) => r.rank === null && r.outcome === 'pending'));
  assert.equal(deriveGroupPageView(5, data, 999), null);
});

test('wildcard pods advance everyone with a win; the final pod never marks outcomes', () => {
  const data = stage();
  data.bracketShape[0] = { ...data.bracketShape[0], advance_rule: 'wildcard' };
  data.rounds[0].matches.forEach((m) => (m.advance_rule = 'wildcard'));
  const rows = deriveGroupPageView(5, data, 10)!.group.scorecard;
  assert.deepEqual(rows.map((r) => r.outcome), ['advances', 'advances', 'advances', 'eliminated']);

  const finalData = stage();
  finalData.bracketShape[0] = { ...finalData.bracketShape[0], is_final: true };
  assert.ok(deriveGroupPageView(5, finalData, 10)!.group.scorecard.every((r) => r.outcome === 'pending'));
});
