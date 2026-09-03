/**
 * Unit tests for roundOf()/groupByRound() (_shared.ts) — the one place every collector in this
 * directory decides "which live round does this event belong to". Covers the tick-boundary check
 * specifically: a warmup-period event's `total_rounds_played` isn't guaranteed to be disjoint from
 * the live match's own round numbers (MatchZy's round counter doesn't reliably reset at
 * `begin_new_match`), so an event before `matchStartTick` must never count as a live round even
 * when its round-number offset happens to collide with one. Also covers the trailing-action
 * correction (#518): `total_rounds_played` increments at `round_end`, but a real event can still
 * land in that round's settle window afterward — it's reattributed back to the round it actually
 * happened in rather than left on the next one.
 *
 * Run:  npx vitest run src/lib/parsers/_shared.test.ts
 */

import assert from 'node:assert/strict';
import { roundOf, groupByRound, type RoundBounds } from './_shared';
import { test, report } from '../test-support/miniTest';

const liveRounds = new Set([1, 2]);
const noSettleWindows = new Map<number, { endTick: number; settleTick: number }>();

test('roundOf: resolves total_rounds_played + 1 when the round is live and the tick is post-match-start', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound: noSettleWindows };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 600 }, bounds), 1);
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1600 }, bounds), 2);
});

test('roundOf: a round-number offset outside liveRounds is dropped', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound: noSettleWindows };
  assert.equal(roundOf({ total_rounds_played: 9, tick: 9600 }, bounds), null);
});

test('roundOf: an event before matchStartTick is dropped even when its round-number offset collides with a live round', () => {
  // The exact scenario that broke match_kills: a warmup death with total_rounds_played=0 (so
  // total_rounds_played+1 === 1, a real live round) but a tick before the match actually started.
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound: noSettleWindows };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 100 }, bounds), null);
});

test('roundOf: matchStartTick of 0 (no begin_new_match found) filters nothing by tick', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 0, settleWindowByRound: noSettleWindows };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 0 }, bounds), 1);
});

test('roundOf: an event landing in the previous round\'s settle window is reattributed to that round (#518)', () => {
  // Round 1 ends at tick 1000 but real trailing action (a bomb's own fuse timer, lingering
  // grenade damage, ...) can still land up to its settle tick, here 1250 — total_rounds_played
  // has already incremented to report round 2 by then.
  const settleWindowByRound = new Map([[1, { endTick: 1000, settleTick: 1250 }]]);
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound };
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1100 }, bounds), 1);
  // At or before the settle tick still counts as round 1's trailing action...
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1250 }, bounds), 1);
  // ...but past it, a real round 2 event resolves normally.
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1251 }, bounds), 2);
});

test('roundOf: an event at or before the previous round\'s own round_end is never reattributed', () => {
  // A round-2-labeled event whose tick is still within (or before) round 1's own live window is
  // not trailing action — it must resolve as round 2 (or be dropped, if round 2 isn't live) rather
  // than being pulled back into round 1.
  const settleWindowByRound = new Map([[1, { endTick: 1000, settleTick: 1250 }]]);
  const bounds: RoundBounds = { liveRounds: new Set([1]), matchStartTick: 0, settleWindowByRound };
  assert.equal(roundOf({ total_rounds_played: 1, tick: 100 }, bounds), null);
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1000 }, bounds), null);
});

test('roundOf: no correction applies when the previous round has no recorded settle window', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound: noSettleWindows };
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1100 }, bounds), 2);
});

test('groupByRound: buckets events by round, dropping pre-match-start and out-of-range events', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500, settleWindowByRound: noSettleWindows };
  const events = [
    { total_rounds_played: 0, tick: 100 }, // pre-match-start, same offset as round 1 — dropped
    { total_rounds_played: 0, tick: 600 }, // round 1
    { total_rounds_played: 0, tick: 700 }, // round 1
    { total_rounds_played: 1, tick: 1600 }, // round 2
    { total_rounds_played: 9, tick: 9600 }, // not a live round — dropped
  ];
  const byRound = groupByRound(events, bounds);
  assert.equal(byRound.get(1)?.length, 2);
  assert.equal(byRound.get(2)?.length, 1);
  assert.equal(byRound.has(9), false);
});

report();
