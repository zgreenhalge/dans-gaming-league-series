/**
 * Unit tests for r2.ts's pure, IO-free surface — demoMatchIdFromKey(), the match-id parsing behind
 * scripts/list-demo-matches.ts's `listDemoMatchIds()`. The R2 calls themselves (get/put/delete/head/
 * list) stay integration-only, the same "extract and test the pure logic, leave IO-bound
 * orchestration untested" split used elsewhere in this repo (e.g. src/lib/dathost-retention.test.ts).
 *
 * Run:  npx vitest run src/lib/r2.test.ts
 */

import assert from 'node:assert/strict';
import { demoMatchIdFromKey, demoSegmentKey, demoManifestKey } from './r2';
import { test, report } from './test-support/miniTest';

test('demoSegmentKey: deterministic per match id and segment index', () => {
  assert.equal(demoSegmentKey(501, 0), '501/segment-0.dem');
  assert.equal(demoSegmentKey(501, 1), '501/segment-1.dem');
});

test('demoManifestKey: deterministic per match id, distinct from the single-file demoKey', () => {
  assert.equal(demoManifestKey(501), '501/demo-manifest.json');
});

test('demoMatchIdFromKey: matches a demo key and returns its match id', () => {
  assert.equal(demoMatchIdFromKey('501/game.dem'), 501);
});

test('demoMatchIdFromKey: returns null for a sibling artifact under the same match prefix', () => {
  assert.equal(demoMatchIdFromKey('501/replay.json'), null);
  assert.equal(demoMatchIdFromKey('501/heatmap.json'), null);
});

test('demoMatchIdFromKey: returns null for a non-numeric or malformed prefix', () => {
  assert.equal(demoMatchIdFromKey('abc/game.dem'), null);
  assert.equal(demoMatchIdFromKey('game.dem'), null);
  assert.equal(demoMatchIdFromKey('501/nested/game.dem'), null);
});

test('demoMatchIdFromKey: returns null for an unrelated bucket key', () => {
  assert.equal(demoMatchIdFromKey('maps/de_such/heatmap.json'), null);
});

report();
