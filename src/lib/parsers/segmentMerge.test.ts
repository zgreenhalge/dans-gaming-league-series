/**
 * Unit tests for segmentMerge.ts — the pure, Buffer-free primitives that let a restart-interrupted
 * match's independently-parsed demo segments be combined into one result. Every function here
 * operates on plain data (round-range descriptors, per-player stat objects, fact-row arrays), so
 * these tests never touch a real demo file — the parsing-level correctness (round anchoring) is
 * `roundSides.test.ts`'s job; this file only proves the merge itself is correct once each segment's
 * own numbers are already right.
 *
 * Run:  npx vitest run src/lib/parsers/segmentMerge.test.ts
 */

import assert from 'node:assert/strict';
import {
  sumNumericFields,
  computeSegmentOffsets,
  checkSegmentAgreement,
  mergeSegmentResults,
  mergeSabremetricResults,
  type SegmentRoundRange,
} from './segmentMerge';
import type { DemoPlayerStat, ParsedDemoResult } from '../demoParser';
import type {
  ParsedDemoSabremetricsResult, DemoSabremetricStat, SabFields,
} from '../types';
import { test, report } from '../test-support/miniTest';

// --- sumNumericFields ---

test('sumNumericFields: sums numeric fields across rows sharing a key, keeps non-numeric fields', () => {
  const rows = [
    { id: 'a', label: 'first', kills: 3, damage: 100 },
    { id: 'a', label: 'second', kills: 5, damage: 50 },
  ];
  const merged = sumNumericFields(rows, ['id']);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'a');
  assert.equal(merged[0].label, 'first'); // first-seen non-numeric value wins
  assert.equal(merged[0].kills, 8);
  assert.equal(merged[0].damage, 150);
});

test('sumNumericFields: distinct keys stay separate, in first-appearance order', () => {
  const rows = [
    { id: 'b', n: 1 },
    { id: 'a', n: 2 },
    { id: 'b', n: 3 },
  ];
  const merged = sumNumericFields(rows, ['id']);
  assert.deepEqual(merged.map((r) => r.id), ['b', 'a']);
  assert.equal(merged.find((r) => r.id === 'b')!.n, 4);
  assert.equal(merged.find((r) => r.id === 'a')!.n, 2);
});

test('sumNumericFields: a single row passes through unchanged', () => {
  const rows = [{ id: 'a', n: 7 }];
  assert.deepEqual(sumNumericFields(rows, ['id']), rows);
});

test('sumNumericFields: a numeric field missing from the first row in a group is still summed, not dropped', () => {
  // A field's "is this numeric" check must look across the whole group, not just the first-seen
  // row — otherwise a field absent from group[0] but present later is silently lost entirely.
  const rows = [
    { id: 'a', x: 1 },
    { id: 'a', y: 2 },
  ];
  const merged = sumNumericFields(rows, ['id']);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].x, 1);
  assert.equal(merged[0].y, 2);
});

test('sumNumericFields: composite keys group only on the exact combination', () => {
  const rows = [
    { player: 1, weapon: 'ak47', shots: 10 },
    { player: 1, weapon: 'usp', shots: 5 },
    { player: 1, weapon: 'ak47', shots: 20 },
    { player: 2, weapon: 'ak47', shots: 1 },
  ];
  const merged = sumNumericFields(rows, ['player', 'weapon']);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r) => r.player === 1 && r.weapon === 'ak47')!.shots, 30);
  assert.equal(merged.find((r) => r.player === 1 && r.weapon === 'usp')!.shots, 5);
  assert.equal(merged.find((r) => r.player === 2 && r.weapon === 'ak47')!.shots, 1);
});

// --- computeSegmentOffsets ---

test('computeSegmentOffsets: a single segment starts at real round 1', () => {
  const segments: SegmentRoundRange[] = [{ firstRoundNumber: 1, liveRoundCount: 23 }];
  const { order, startingRealRound } = computeSegmentOffsets(segments);
  assert.deepEqual(order, [0]);
  assert.deepEqual(startingRealRound, [1]);
});

test('computeSegmentOffsets: two segments already in order (match 120 shape)', () => {
  // Segment A: 4 live rounds (engine 1-4). Segment B: 19 live rounds starting at engine 5.
  const segments: SegmentRoundRange[] = [
    { firstRoundNumber: 1, liveRoundCount: 4 },
    { firstRoundNumber: 5, liveRoundCount: 19 },
  ];
  const { order, startingRealRound } = computeSegmentOffsets(segments);
  assert.deepEqual(order, [0, 1]);
  assert.deepEqual(startingRealRound, [1, 5]);
});

test('computeSegmentOffsets: segments given out of upload order are still anchored correctly', () => {
  // Same match-120 shape, but B passed first in the input array.
  const segments: SegmentRoundRange[] = [
    { firstRoundNumber: 5, liveRoundCount: 19 }, // index 0 = "B"
    { firstRoundNumber: 1, liveRoundCount: 4 },  // index 1 = "A"
  ];
  const { order, startingRealRound } = computeSegmentOffsets(segments);
  assert.deepEqual(order, [1, 0]); // A (index 1) sorts before B (index 0)
  assert.equal(startingRealRound[1], 1); // A starts at real round 1
  assert.equal(startingRealRound[0], 5); // B starts at real round 5
});

test('computeSegmentOffsets: three segments chain their offsets', () => {
  const segments: SegmentRoundRange[] = [
    { firstRoundNumber: 1, liveRoundCount: 10 },
    { firstRoundNumber: 11, liveRoundCount: 5 },
    { firstRoundNumber: 16, liveRoundCount: 8 },
  ];
  const { startingRealRound } = computeSegmentOffsets(segments);
  assert.deepEqual(startingRealRound, [1, 11, 16]);
});

// --- checkSegmentAgreement ---

function agreementInput(overrides: {
  segments: SegmentRoundRange[];
  playerIdsBySegment: number[][];
}) {
  const { order } = computeSegmentOffsets(overrides.segments);
  return { segments: overrides.segments, order, playerIdsBySegment: overrides.playerIdsBySegment };
}

test('checkSegmentAgreement: contiguous ranges and matching rosters pass', () => {
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 1, liveRoundCount: 4 },
      { firstRoundNumber: 5, liveRoundCount: 19 },
    ],
    playerIdsBySegment: [[1, 2, 3, 4], [1, 2, 3, 4]],
  });
  const result = checkSegmentAgreement(input);
  assert.equal(result.ok, true, `expected ok, got: ${result.flags.join('; ')}`);
  assert.deepEqual(result.flags, []);
});

test('checkSegmentAgreement: a gap between segments is flagged', () => {
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 1, liveRoundCount: 4 }, // ends at round 4
      { firstRoundNumber: 6, liveRoundCount: 19 }, // starts at 6, round 5 missing
    ],
    playerIdsBySegment: [[1, 2, 3, 4], [1, 2, 3, 4]],
  });
  const result = checkSegmentAgreement(input);
  assert.equal(result.ok, false);
  assert.ok(result.flags.some((f) => /gap/i.test(f)), result.flags.join('; '));
});

test('checkSegmentAgreement: overlapping round ranges are flagged', () => {
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 1, liveRoundCount: 4 }, // ends at round 4
      { firstRoundNumber: 4, liveRoundCount: 19 }, // round 4 replayed in both
    ],
    playerIdsBySegment: [[1, 2, 3, 4], [1, 2, 3, 4]],
  });
  const result = checkSegmentAgreement(input);
  assert.equal(result.ok, false);
  assert.ok(result.flags.some((f) => /overlap/i.test(f)), result.flags.join('; '));
});

test('checkSegmentAgreement: a roster mismatch across segments is flagged', () => {
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 1, liveRoundCount: 4 },
      { firstRoundNumber: 5, liveRoundCount: 19 },
    ],
    playerIdsBySegment: [[1, 2, 3, 4], [1, 2, 3, 99]], // segment B resolved a different 4th player
  });
  const result = checkSegmentAgreement(input);
  assert.equal(result.ok, false);
  assert.ok(result.flags.some((f) => /roster/i.test(f)), result.flags.join('; '));
});

test('checkSegmentAgreement: a segment resolving zero players gets a distinct, non-alarming flag, not "roster mismatch"', () => {
  // A short or manually-started recording can legitimately have no player-info table populated —
  // that's a different confidence level than a segment resolving a genuinely different roster, so
  // it must not read as "wrong file paired" (see the mismatch test above for that case).
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 1, liveRoundCount: 4 },
      { firstRoundNumber: 5, liveRoundCount: 19 },
    ],
    playerIdsBySegment: [[], [1, 2, 3, 4]], // segment A resolved no players at all
  });
  const result = checkSegmentAgreement(input);
  assert.ok(result.flags.some((f) => /zero players/i.test(f)), result.flags.join('; '));
  assert.ok(!result.flags.some((f) => /roster mismatch/i.test(f)), result.flags.join('; '));
});

test('checkSegmentAgreement: a single segment always passes (nothing to compare)', () => {
  const input = agreementInput({
    segments: [{ firstRoundNumber: 1, liveRoundCount: 23 }],
    playerIdsBySegment: [[1, 2, 3, 4]],
  });
  const result = checkSegmentAgreement(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.flags, []);
});

test('checkSegmentAgreement: a segment with zero live rounds is flagged distinctly, not as a false gap against the real segments', () => {
  // firstRoundNumber defaults to 0 for a segment that yielded no live rounds at all (a corrupted
  // or unparseable file) — sorting it to the front by that 0 must not poison the gap/overlap
  // comparison against the segments that actually have rounds.
  const input = agreementInput({
    segments: [
      { firstRoundNumber: 0, liveRoundCount: 0 }, // contributed nothing
      { firstRoundNumber: 1, liveRoundCount: 23 },
    ],
    playerIdsBySegment: [[], [1, 2, 3, 4]],
  });
  const result = checkSegmentAgreement(input);
  assert.ok(result.flags.some((f) => /zero live rounds/i.test(f)), result.flags.join('; '));
  assert.ok(!result.flags.some((f) => /gap/i.test(f)), result.flags.join('; '));
});

// --- mergeSegmentResults (parseDemoFile shape) ---

function playerStat(overrides: Partial<DemoPlayerStat>): DemoPlayerStat {
  return {
    player_id: 1, faction: 'SHIRTS', kills: 0, deaths: 0, assists: 0, damage: 0,
    rounds_played: 0, rounds_won: 0, adr: 0, is_win: false,
    ...overrides,
  };
}

test('mergeSegmentResults: combines match 120\'s two segments into the true 13-10 result', () => {
  // Segment A (73.dem): SKINS 3 - SHIRTS 1, 4 rounds. Two players shown for brevity (one per side);
  // real matches have 4, but the merge logic is per-player and doesn't care about roster size.
  const segmentA: ParsedDemoResult = {
    stats: [
      playerStat({ player_id: 1, faction: 'SHIRTS', kills: 4, deaths: 5, assists: 1, damage: 400, rounds_played: 4, rounds_won: 1, adr: 100, is_win: false }),
      playerStat({ player_id: 2, faction: 'SKINS', kills: 6, deaths: 3, assists: 0, damage: 500, rounds_played: 4, rounds_won: 3, adr: 125, is_win: true }),
    ],
    shirts_score: 1,
    skins_score: 3,
    round_history: [1, 2, 3, 4].map((n) => ({ n, winner: 'SKINS' as const, side: 'CT' as const, condition: 'elim' as const })),
    warnings: [],
    inferred_side: 'CT',
  };
  // Segment B (121.dem, offset-corrected): SKINS 7 - SHIRTS 12, 19 rounds (engine 5-23).
  const segmentB: ParsedDemoResult = {
    stats: [
      playerStat({ player_id: 1, faction: 'SHIRTS', kills: 20, deaths: 15, assists: 3, damage: 1900, rounds_played: 19, rounds_won: 12, adr: 100, is_win: true }),
      playerStat({ player_id: 2, faction: 'SKINS', kills: 14, deaths: 19, assists: 2, damage: 1400, rounds_played: 19, rounds_won: 7, adr: 74, is_win: false }),
    ],
    shirts_score: 12,
    skins_score: 7,
    round_history: Array.from({ length: 19 }, (_, i) => ({ n: i + 5, winner: 'SHIRTS' as const, side: 'CT' as const, condition: 'elim' as const })),
    warnings: [],
    inferred_side: null,
  };

  const merged = mergeSegmentResults([segmentA, segmentB]);

  assert.equal(merged.shirts_score, 13);
  assert.equal(merged.skins_score, 10);
  assert.equal(merged.round_history!.length, 23);
  assert.deepEqual(merged.round_history!.map((r) => r.n), Array.from({ length: 23 }, (_, i) => i + 1));

  const p1 = merged.stats.find((s) => s.player_id === 1)!;
  assert.equal(p1.kills, 24);
  assert.equal(p1.deaths, 20);
  assert.equal(p1.assists, 4);
  assert.equal(p1.damage, 2300);
  assert.equal(p1.rounds_played, 23);
  assert.equal(p1.rounds_won, 13); // shirts total
  assert.equal(p1.adr, Math.round(2300 / 23));
  assert.equal(p1.is_win, true); // 13 > 10

  const p2 = merged.stats.find((s) => s.player_id === 2)!;
  assert.equal(p2.rounds_won, 10); // skins total
  assert.equal(p2.is_win, false);

  assert.equal(merged.inferred_side, 'CT'); // the one non-null value across segments; no disagreement
});

test('mergeSegmentResults: segments agreeing on inferred side (one null, one resolved) is not a disagreement', () => {
  const seg = (inferred_side: 'CT' | 'T' | null): ParsedDemoResult => ({
    stats: [playerStat({ player_id: 1 })],
    shirts_score: 1, skins_score: 0,
    round_history: [{ n: 1, winner: 'SHIRTS', side: 'CT', condition: 'elim' }],
    warnings: [],
    inferred_side,
  });
  const merged = mergeSegmentResults([seg(null), seg('T')]);
  assert.equal(merged.inferred_side, 'T');
  assert.ok(!merged.warnings.some((w) => /disagree/i.test(w)));
});

test('mergeSegmentResults: segments disagreeing on inferred side null the score instead of returning a number built from incompatible attributions', () => {
  // Each segment's own shirts_score/skins_score is internally consistent (computed from that
  // segment's own effectiveSide), but a disagreement between segments' independently-inferred
  // sides means those attributions are mutually incompatible — only possible to reach in the
  // first place when nothing is stored, so nothing else papers over the ambiguity.
  const seg = (inferred_side: 'CT' | 'T' | null): ParsedDemoResult => ({
    stats: [playerStat({ player_id: 1, rounds_won: 1, rounds_played: 1 })],
    shirts_score: 1, skins_score: 0,
    round_history: [{ n: 1, winner: 'SHIRTS', side: 'CT', condition: 'elim' }],
    warnings: [],
    inferred_side,
  });
  const merged = mergeSegmentResults([seg('CT'), seg('T')]);
  assert.equal(merged.inferred_side, null);
  assert.equal(merged.shirts_score, null);
  assert.equal(merged.skins_score, null);
  assert.equal(merged.round_history, null);
  assert.ok(merged.stats.every((s) => s.is_win === false));
  assert.ok(merged.warnings.some((w) => /disagree/i.test(w)), merged.warnings.join('; '));
});

test('mergeSegmentResults: an unresolvable side in any segment makes the combined score null, not silently partial', () => {
  const known: ParsedDemoResult = {
    stats: [playerStat({ player_id: 1, rounds_won: 4, rounds_played: 4 })],
    shirts_score: 4,
    skins_score: 0,
    round_history: [1, 2, 3, 4].map((n) => ({ n, winner: 'SHIRTS' as const, side: 'CT' as const, condition: 'elim' as const })),
    warnings: [],
    inferred_side: 'CT',
  };
  const unknown: ParsedDemoResult = {
    stats: [playerStat({ player_id: 1, rounds_won: 0, rounds_played: 19 })],
    shirts_score: null,
    skins_score: null,
    round_history: null,
    warnings: ['Starting side unknown — rounds won cannot be determined from the demo. Enter the score manually.'],
    inferred_side: null,
  };
  const merged = mergeSegmentResults([known, unknown]);
  assert.equal(merged.shirts_score, null);
  assert.equal(merged.skins_score, null);
  assert.ok(merged.stats.every((s) => s.is_win === false));
  assert.ok(merged.warnings.some((w) => /starting side unknown/i.test(w)));
});

test('mergeSegmentResults: duplicate warnings across segments are deduped', () => {
  const w = 'Resolved "X" (1) to roster player "Y" by elimination — verify this is correct.';
  const seg = (): ParsedDemoResult => ({
    stats: [playerStat({ player_id: 1 })],
    shirts_score: 1, skins_score: 0,
    round_history: [{ n: 1, winner: 'SHIRTS', side: 'CT', condition: 'elim' }],
    warnings: [w],
    inferred_side: null,
  });
  const merged = mergeSegmentResults([seg(), seg()]);
  assert.deepEqual(merged.warnings, [w]);
});

// --- mergeSabremetricResults (parseDemoSabremetrics shape) ---

function sab(player_id: number, overrides: Partial<SabFields>): DemoSabremetricStat {
  const ZERO: SabFields = {
    damage_ct: 0, damage_t: 0, kast_rounds: 0, utility_damage: 0, flashes_thrown: 0,
    plants: 0, defuses: 0, trade_kill_opportunities: 0, trade_kill_attempts: 0,
    trade_kill_successes: 0, traded_death_opportunities: 0, traded_death_attempts: 0,
    traded_death_successes: 0, he_thrown: 0, he_damage: 0, shots_hit_no_awp: 0,
    headshot_hits_no_awp: 0, counter_strafe_shots: 0, counter_strafe_good_shots: 0,
    spray_shots_fired: 0, spray_shots_hit: 0, smokes_blocking_push: 0, ct_smokes_thrown: 0,
    unused_util_value_on_death_total: 0, rounds_dropped_on_reload_total: 0, reloads_total: 0,
  };
  return { player_id, sabremetrics: { ...ZERO, ...overrides } };
}

function baseSabResult(overrides: Partial<ParsedDemoSabremetricsResult>): ParsedDemoSabremetricsResult {
  return {
    sabremetrics: [], weaponStats: [], matchKills: [], matchRounds: [],
    matchUtilityThrows: [], matchRoundEconomy: [], matchDamageEvents: [], warnings: [],
    ...overrides,
  };
}

test('mergeSabremetricResults: sums SabFields per player across segments', () => {
  const segA = baseSabResult({ sabremetrics: [sab(1, { flashes_thrown: 2, plants: 1 })] });
  const segB = baseSabResult({ sabremetrics: [sab(1, { flashes_thrown: 5, defuses: 2 })] });
  const merged = mergeSabremetricResults([segA, segB]);
  const p1 = merged.sabremetrics.find((s) => s.player_id === 1)!;
  assert.equal(p1.sabremetrics.flashes_thrown, 7);
  assert.equal(p1.sabremetrics.plants, 1);
  assert.equal(p1.sabremetrics.defuses, 2);
});

test('mergeSabremetricResults: weaponStats sum per (player, weapon) bucket, distinct weapons stay separate rows', () => {
  const segA = baseSabResult({
    weaponStats: [{
      player_id: 1,
      weaponStats: [{ weapon: 'ak47', shots_fired: 10, shots_hit: 4, headshot_hits: 1, damage_dealt: 200, rounds_played: 4 }],
      economyStats: [],
    }],
  });
  const segB = baseSabResult({
    weaponStats: [{
      player_id: 1,
      weaponStats: [
        { weapon: 'ak47', shots_fired: 20, shots_hit: 8, headshot_hits: 2, damage_dealt: 400, rounds_played: 19 },
        { weapon: 'usp_silencer', shots_fired: 5, shots_hit: 3, headshot_hits: 0, damage_dealt: 60, rounds_played: 19 },
      ],
      economyStats: [],
    }],
  });
  const merged = mergeSabremetricResults([segA, segB]);
  const p1 = merged.weaponStats.find((w) => w.player_id === 1)!;
  assert.equal(p1.weaponStats.length, 2);
  const ak = p1.weaponStats.find((w) => w.weapon === 'ak47')!;
  assert.equal(ak.shots_fired, 30);
  assert.equal(ak.damage_dealt, 600);
  const usp = p1.weaponStats.find((w) => w.weapon === 'usp_silencer')!;
  assert.equal(usp.shots_fired, 5);
});

test('mergeSabremetricResults: fact-row arrays (matchKills, matchRounds, ...) are concatenated untouched', () => {
  const segA = baseSabResult({
    matchKills: [{ round_number: 1, attacker_player_id: 1, victim_player_id: 2, assister_player_id: null, weapon: 'ak47', headshot: false, noscope: false, wallbang: false, blind_kill: false, midair: false, is_teamkill: false, tick: 100 }],
    matchRounds: [{ round_number: 1, winner_side: 'CT', shirts_side: 'CT', win_reason: 'elim' }],
  });
  const segB = baseSabResult({
    matchKills: [{ round_number: 5, attacker_player_id: 2, victim_player_id: 1, assister_player_id: null, weapon: 'usp_silencer', headshot: true, noscope: false, wallbang: false, blind_kill: false, midair: false, is_teamkill: false, tick: 900 }],
    matchRounds: [{ round_number: 5, winner_side: 'T', shirts_side: 'T', win_reason: 'bomb' }],
  });
  const merged = mergeSabremetricResults([segA, segB]);
  assert.equal(merged.matchKills.length, 2);
  assert.deepEqual(merged.matchKills.map((k) => k.round_number), [1, 5]);
  assert.equal(merged.matchRounds.length, 2);
});

test('mergeSabremetricResults: fact-row arrays are sorted back into round order regardless of segment/argument order', () => {
  // orchestrateSegments builds `segments` in the caller's own argument order, not the
  // round-order-sorted order computeSegmentOffsets derives — a caller passing segments out of
  // chronological order (e.g. --demo b.dem --demo a.dem where b is actually second) must not
  // leave the merged fact-row arrays in argument order.
  const segB = baseSabResult({
    matchKills: [{ round_number: 5, attacker_player_id: 2, victim_player_id: 1, assister_player_id: null, weapon: 'usp_silencer', headshot: true, noscope: false, wallbang: false, blind_kill: false, midair: false, is_teamkill: false, tick: 900 }],
    matchRounds: [{ round_number: 5, winner_side: 'T', shirts_side: 'T', win_reason: 'bomb' }],
  });
  const segA = baseSabResult({
    matchKills: [{ round_number: 1, attacker_player_id: 1, victim_player_id: 2, assister_player_id: null, weapon: 'ak47', headshot: false, noscope: false, wallbang: false, blind_kill: false, midair: false, is_teamkill: false, tick: 100 }],
    matchRounds: [{ round_number: 1, winner_side: 'CT', shirts_side: 'CT', win_reason: 'elim' }],
  });
  const merged = mergeSabremetricResults([segB, segA]); // B (round 5) passed before A (round 1)
  assert.deepEqual(merged.matchKills.map((k) => k.round_number), [1, 5]);
  assert.deepEqual(merged.matchRounds.map((r) => r.round_number), [1, 5]);
});

test('mergeSabremetricResults: warnings are deduped across segments', () => {
  const w = 'Unused Utility on Death not computed: demoparser2\'s "inventory" tick field failed (boom).';
  const segA = baseSabResult({ warnings: [w] });
  const segB = baseSabResult({ warnings: [w] });
  const merged = mergeSabremetricResults([segA, segB]);
  assert.deepEqual(merged.warnings, [w]);
});

report();
