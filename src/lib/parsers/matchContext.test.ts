/**
 * Unit tests for dedupeDeathEvents() (matchContext.ts) — the shared choke point that drops a
 * duplicate player_death for the same (round, victim) before any event-based collector
 * (KAST, trades, multikills, match_kills, ...) sees the deathEvents stream, so a genuine
 * demoparser2-level duplicate can't get silently double-counted by every consumer independently.
 * Also covers computeSettleTicks() and the trailing-action scenario that used to masquerade as a
 * duplicate before roundOf()'s own correction (#518, tested directly in _shared.test.ts).
 *
 * Run:  npx vitest run src/lib/parsers/matchContext.test.ts
 */

import assert from 'node:assert/strict';
import { dedupeDeathEvents, computeSettleTicks } from './matchContext';
import { makeContext, death } from './matchContextFixture';
import type { RoundSideInfo } from './roundSides';
import { test, report } from '../test-support/miniTest';

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }, { roundNumber: 2, winnerSide: 'T' as const }];

function round(roundNumber: number, endTick: number): RoundSideInfo {
  return { roundNumber, endTick, winnerSide: 'CT', shirtsSide: 'CT', winReason: 'elim' };
}

test('dedupeDeathEvents: a genuine duplicate death for the same (round, victim) is dropped and warned', () => {
  // Both events are post-match-start and in-round — a demoparser2-level duplicate, not warmup
  // pollution (see the dedicated test below). That's a real anomaly, so it must be visible
  // (context.warnings, which gates auto-commit — evaluateAutoCommit()), not silently dropped.
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 1, tick: 950, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = dedupeDeathEvents(deaths, ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].attacker_steamid, 'a');
  assert.equal(ctx.warnings.length, 1);
  assert.match(ctx.warnings[0], /Duplicate player_death for c in round 1/);
});

test('dedupeDeathEvents: a warmup-period death is left alone by dedup (roundOf already excludes it by tick)', () => {
  // The actual bug behind #452's missing match_kills rows: a warmup death with
  // total_rounds_played=0 (so total_rounds_played+1 === 1, a real live round number) landing
  // before matchStartTick. roundOf() excludes it by tick, so it never collides with the real
  // round-1 death in the dedup key space — both events pass through, no warning.
  const deaths = [
    death({ round: 1, tick: 50, victim: 'c', attacker: 'b', weapon: 'glock' }), // warmup, tick < matchStartTick
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }), // the real round-1 kill
  ];
  const ctx = makeContext({ rounds, sides, deaths, matchStartTick: 100 });
  const out = dedupeDeathEvents(deaths, ctx);
  assert.equal(out.length, 2);
  assert.equal(ctx.warnings.length, 0);
});

test('dedupeDeathEvents: the same victim dying in different rounds is untouched', () => {
  const deaths = [
    death({ round: 1, tick: 105, victim: 'c', attacker: 'a', weapon: 'ak47' }),
    death({ round: 2, tick: 1105, victim: 'c', attacker: 'b', weapon: 'usp_silencer' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = dedupeDeathEvents(deaths, ctx);
  assert.equal(out.length, 2);
  assert.equal(ctx.warnings.length, 0);
});

test('dedupeDeathEvents: an event outside any live round passes through untouched', () => {
  const deaths = [death({ round: 99, tick: 50, victim: 'c', attacker: 'a', weapon: 'ak47' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = dedupeDeathEvents(deaths, ctx);
  assert.equal(out.length, 1);
  assert.equal(ctx.warnings.length, 0);
});

test('dedupeDeathEvents: a bomb detonating on its own fuse timer after round_end no longer collides with the next round\'s real death (#518)', () => {
  // Round 1 ends (round_end) at tick 1000, but the planted bomb doesn't actually detonate until
  // tick 1050 — real trailing action, well within round 1's settle window (up to 1250). Its
  // player_death carries total_rounds_played=1 (round 2's naive offset) purely because
  // total_rounds_played had already incremented at round_end. Without roundOf()'s correction this
  // would collide with c's genuine round-2 death below and get dropped by dedup — with it, both
  // resolve to their real rounds and neither is touched.
  const roundsWithSettle = [
    { roundNumber: 1, winnerSide: 'CT' as const, endTick: 1000, settleTick: 1250 },
    { roundNumber: 2, winnerSide: 'T' as const, endTick: 2000 },
  ];
  const deaths = [
    death({ round: 2, tick: 1050, victim: 'c', attacker: null, weapon: 'planted_c4' }),
    death({ round: 2, tick: 1800, victim: 'c', attacker: 'a', weapon: 'm4a1_silencer' }),
  ];
  const ctx = makeContext({ rounds: roundsWithSettle, sides, deaths });
  const out = dedupeDeathEvents(deaths, ctx);
  assert.equal(out.length, 2);
  assert.equal(ctx.warnings.length, 0);
  assert.equal(out[0].weapon, 'planted_c4');
  assert.equal(out[1].weapon, 'm4a1_silencer');
  // The bomb death is now correctly attributed to round 1, the real elimination to round 2.
  assert.ok(ctx.roundDeaths.get('c')?.has(1));
  assert.ok(ctx.roundDeaths.get('c')?.has(2));
});

test('computeSettleTicks: middle rounds settle one tick before their own round_officially_ended; the last round settles at its own round_end tick', () => {
  // Three rounds produce two transition events (none follows the match's last round) — the same
  // shape real demos have. One tick *before* round_officially_ended, not at it — the reset is
  // already complete by that exact tick (confirmed against real data). The last round has no
  // following round_start to trigger a reset at all, so its own round_end tick is already settled.
  const result = computeSettleTicks(
    [round(1, 100), round(2, 500), round(3, 900)],
    [220, 620],
  );
  assert.deepEqual(Array.from(result), [219, 619, 900]);
});

test('computeSettleTicks: an unsorted officiallyEndedTicks list is still matched correctly', () => {
  const result = computeSettleTicks(
    [round(1, 100), round(2, 500), round(3, 900)],
    [620, 220], // deliberately out of order
  );
  assert.deepEqual(Array.from(result), [219, 619, 900]);
});

test('computeSettleTicks: an outlier gap is read from the real event tick, not assumed at a fixed offset', () => {
  // Real demos show the gap is usually ~320 ticks (5s) but not always — an observed outlier of
  // 960 in real match data. The last round still has no following event, so it settles at its own
  // round_end tick rather than guessing an offset.
  const result = computeSettleTicks(
    [round(1, 100), round(2, 1200)],
    [1060],
  );
  assert.deepEqual(Array.from(result), [1059, 1200]);
});

report();
