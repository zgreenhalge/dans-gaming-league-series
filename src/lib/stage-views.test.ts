/**
 * Tests for the week/round/group derivations (stage-views.ts) and their fetchers
 * (queries/groups.ts) against the shared fixture. Run: npx vitest run src/lib/stage-views.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

import { getWeekView, getGauntletStageData, getWeekRow, getPodSeasonId, getStagePagePaths } from './queries';
import { deriveGroupPageView, deriveRoundView, stageStatus, type GauntletStageData } from './stage-views';
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
  assert.equal(view.scorecard[0].movement?.before, null);
  assert.deepEqual(view.nav.items.map((i) => i.href), ['/seasons/1/weeks/10', '/seasons/1/weeks/11']);
  assert.equal(view.nav.prev, null);
  assert.equal(view.nav.next?.href, '/seasons/1/weeks/11');
  assert.equal(await getWeekView(1, 9999), null);
});

test('getWeekRow / getPodSeasonId resolve ids to their season', async () => {
  assert.deepEqual(await getWeekRow(11), { id: 11, season_id: 1, week_number: 2 });
  assert.equal(await getWeekRow(9999), null);
  assert.equal(await getPodSeasonId(1000), 2);
  assert.equal(await getPodSeasonId(9999), null);
});

test('getGauntletStageData: rounds, bracket shape and week ids for the paired gauntlet', async () => {
  const data = await getGauntletStageData(2);
  assert.equal(data.weekIdByRound.get(1), 12);
  assert.equal(data.rounds[0].week_id, 12);
  assert.deepEqual(data.bracketShape.map((p) => p.id), [1000]);
  const round = deriveRoundView(1, data, 12)!;
  assert.equal(round.groups.length, 1);
  assert.equal(round.groups[0].label, 'Final');
});

test('getStagePagePaths: weeks, rounds and groups, with gauntlets filed under their paired regular season', async () => {
  const paths = await getStagePagePaths();
  assert.ok(paths.includes('/seasons/1/weeks/10'));
  assert.ok(paths.includes('/seasons/1/rounds/12'), 'gauntlet 2 pairs with regular season 1');
  assert.ok(paths.includes('/seasons/1/groups/1000'));
  assert.ok(paths.includes('/seasons/4/rounds/14'), 'an unpaired gauntlet is its own hub');
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
    weekIdByRound: new Map([[1, 100]]),
  };
}

test('deriveRoundView: groups, nav and an unscheduled later round', () => {
  const view = deriveRoundView(5, stage(), 100)!;
  assert.equal(view.roundNumber, 1);
  assert.equal(view.status, 'complete');
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].label, 'Group 1');
  assert.deepEqual(view.nav.items.map((i) => [i.chip, i.href]), [['1', '/seasons/5/rounds/100'], ['2', null]]);
  assert.equal(view.nav.next, null, 'a round without a week row has nothing to link to');
  assert.equal(deriveRoundView(5, stage(), 999), null);
});

test('group scorecard: ranks by the canonical gauntlet order and marks who advances', () => {
  const view = deriveGroupPageView(5, stage(), 10)!;
  const rows = view.group.scorecard;
  assert.equal(rows[0].player_id, 1);
  assert.equal(rows[0].wins, 2);
  assert.deepEqual(rows.map((r) => r.outcome), ['advances', 'eliminated', 'eliminated', 'eliminated']);
  assert.deepEqual(rows.map((r) => r.seed), rows.map((r) => r.player_id), 'seed comes from the pod slots');
  assert.equal(view.weekId, 100);
  assert.equal(view.prev, null);
  assert.equal(view.next?.href, '/seasons/5/groups/11');
  assert.equal(view.next?.label, 'Round 2 · Final');
});

test('an unmaterialized pod lists its resolved slots in seed order, unranked and pending', () => {
  const data = stage();
  data.bracketShape[1] = pod(11, 2, 0, 'single', true, false, [[3, 3], [1, 1], [2, 2], [4, 4]]);
  const view = deriveGroupPageView(5, data, 11)!;
  assert.equal(view.group.status, 'upcoming');
  assert.deepEqual(view.group.scorecard.map((r) => r.player_id), [1, 2, 3, 4]);
  assert.ok(view.group.scorecard.every((r) => r.rank === null && r.outcome === 'pending'));
  assert.equal(view.weekId, null);
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
