/**
 * Unit tests for roundOf()/groupByRound() (_shared.ts) — the one place every collector in this
 * directory decides "which live round does this event belong to". Covers the tick-boundary check
 * specifically: a warmup-period event's `total_rounds_played` isn't guaranteed to be disjoint from
 * the live match's own round numbers (MatchZy's round counter doesn't reliably reset at
 * `begin_new_match`), so an event before `matchStartTick` must never count as a live round even
 * when its round-number offset happens to collide with one.
 *
 * Run:  npx vitest run src/lib/parsers/_shared.test.ts
 */

import assert from 'node:assert/strict';
import { roundOf, groupByRound, type RoundBounds } from './_shared';
import { test, report } from '../test-support/miniTest';

const liveRounds = new Set([1, 2]);

test('roundOf: resolves total_rounds_played + 1 when the round is live and the tick is post-match-start', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500 };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 600 }, bounds), 1);
  assert.equal(roundOf({ total_rounds_played: 1, tick: 1600 }, bounds), 2);
});

test('roundOf: a round-number offset outside liveRounds is dropped', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500 };
  assert.equal(roundOf({ total_rounds_played: 9, tick: 9600 }, bounds), null);
});

test('roundOf: an event before matchStartTick is dropped even when its round-number offset collides with a live round', () => {
  // The exact scenario that broke match_kills: a warmup death with total_rounds_played=0 (so
  // total_rounds_played+1 === 1, a real live round) but a tick before the match actually started.
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500 };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 100 }, bounds), null);
});

test('roundOf: matchStartTick of 0 (no begin_new_match found) filters nothing by tick', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 0 };
  assert.equal(roundOf({ total_rounds_played: 0, tick: 0 }, bounds), 1);
});

test('groupByRound: buckets events by round, dropping pre-match-start and out-of-range events', () => {
  const bounds: RoundBounds = { liveRounds, matchStartTick: 500 };
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
