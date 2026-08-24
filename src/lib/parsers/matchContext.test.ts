/**
 * Unit tests for dedupeDeathEvents() (matchContext.ts) — the shared choke point that drops a
 * duplicate player_death for the same (round, victim) before any event-based collector
 * (KAST, trades, multikills, match_kills, ...) sees the deathEvents stream, so a genuine
 * demoparser2-level duplicate can't get silently double-counted by every consumer independently.
 *
 * Run:  npx vitest run src/lib/parsers/matchContext.test.ts
 */

import assert from 'node:assert/strict';
import { dedupeDeathEvents } from './matchContext';
import { makeContext, death } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }, { roundNumber: 2, winnerSide: 'T' as const }];

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

report();
