/**
 * Unit tests for `parseMatchzyEventIdentity()` — the best-effort `{event, matchid}` extraction
 * shared by every MatchZy remote-log event, regardless of whether its other fields are understood.
 *
 * Run:  npx tsx src/lib/demo/matchzyContact.test.ts
 */

import assert from 'node:assert/strict';
import { parseMatchzyEventIdentity } from './matchzyContact';
import { test, report } from '../test-support/miniTest';

test('parseMatchzyEventIdentity: extracts event + matchid from any recognized-shaped body', () => {
  assert.deepEqual(
    parseMatchzyEventIdentity({ event: 'going_live', matchid: 100 }),
    { event: 'going_live', matchid: 100 },
  );
});

test('parseMatchzyEventIdentity: works for an event type with no other parsed fields', () => {
  assert.deepEqual(
    parseMatchzyEventIdentity({ event: 'series_start', matchid: 42, extra: 'ignored' }),
    { event: 'series_start', matchid: 42 },
  );
});

test('parseMatchzyEventIdentity: non-object body is rejected', () => {
  assert.equal(parseMatchzyEventIdentity(null), null);
  assert.equal(parseMatchzyEventIdentity('going_live'), null);
});

test('parseMatchzyEventIdentity: missing or non-string event is rejected', () => {
  assert.equal(parseMatchzyEventIdentity({ matchid: 100 }), null);
  assert.equal(parseMatchzyEventIdentity({ event: 42, matchid: 100 }), null);
});

test('parseMatchzyEventIdentity: non-positive or non-integer matchid is rejected', () => {
  assert.equal(parseMatchzyEventIdentity({ event: 'going_live', matchid: 0 }), null);
  assert.equal(parseMatchzyEventIdentity({ event: 'going_live', matchid: -1 }), null);
  assert.equal(parseMatchzyEventIdentity({ event: 'going_live', matchid: 1.5 }), null);
  assert.equal(parseMatchzyEventIdentity({ event: 'going_live' }), null);
});

report();
