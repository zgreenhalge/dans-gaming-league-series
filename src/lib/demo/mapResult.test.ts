/**
 * Unit tests for `parseMapResultEvent()` — the shape guard between MatchZy's remote-log webhook
 * body and the `MatchzyMapResult` the auto-commit cross-check trusts. Only R2-independent parsing
 * is covered here; `putMapResult`/`getMapResult` are thin R2 wrappers with no branching to lock.
 *
 * Run:  npx tsx src/lib/demo/mapResult.test.ts
 */

import assert from 'node:assert/strict';
import { parseMapResultEvent } from './mapResult';
import { test, report } from '../test-support/miniTest';

test('parseMapResultEvent: a well-formed map_result parses to scores', () => {
  const r = parseMapResultEvent({
    event: 'map_result',
    matchid: 100,
    team1: { score: 13 },
    team2: { score: 9 },
  });
  assert.deepEqual(r, { matchid: 100, team1: { score: 13 }, team2: { score: 9 } });
});

test('parseMapResultEvent: any other event type is not a map_result', () => {
  assert.equal(parseMapResultEvent({ event: 'round_end', matchid: 100, team1: { score: 1 }, team2: { score: 0 } }), null);
});

test('parseMapResultEvent: non-object body is rejected', () => {
  assert.equal(parseMapResultEvent(null), null);
  assert.equal(parseMapResultEvent('map_result'), null);
  assert.equal(parseMapResultEvent(undefined), null);
});

test('parseMapResultEvent: non-positive or non-integer matchid is rejected', () => {
  const base = { event: 'map_result', team1: { score: 13 }, team2: { score: 9 } };
  assert.equal(parseMapResultEvent({ ...base, matchid: 0 }), null);
  assert.equal(parseMapResultEvent({ ...base, matchid: -5 }), null);
  assert.equal(parseMapResultEvent({ ...base, matchid: 1.5 }), null);
  assert.equal(parseMapResultEvent({ ...base, matchid: 'abc' }), null);
});

test('parseMapResultEvent: missing or negative team scores are rejected', () => {
  const base = { event: 'map_result', matchid: 100 };
  assert.equal(parseMapResultEvent({ ...base, team1: {}, team2: { score: 9 } }), null);
  assert.equal(parseMapResultEvent({ ...base, team1: { score: -1 }, team2: { score: 9 } }), null);
  assert.equal(parseMapResultEvent({ ...base, team1: { score: 13 } }), null); // team2 missing entirely
});

test('parseMapResultEvent: a 0-0 result is valid (not mistaken for a missing score)', () => {
  const r = parseMapResultEvent({ event: 'map_result', matchid: 100, team1: { score: 0 }, team2: { score: 0 } });
  assert.deepEqual(r, { matchid: 100, team1: { score: 0 }, team2: { score: 0 } });
});

report();
