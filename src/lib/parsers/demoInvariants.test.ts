/**
 * Unit tests for checkDemoParseInvariants() — proves each invariant actually trips on a violating
 * parse, so the real-demo corpus test (realDemoCorpus.test.ts) can trust an empty result.
 *
 * Run:  npx vitest run src/lib/parsers/demoInvariants.test.ts
 */

import assert from 'node:assert/strict';
import { checkDemoParseInvariants } from './demoInvariants';
import type { ParsedDemoResult } from '../demoParser';
import type { ParsedDemoSabremetricsResult } from '../types';
import { test, report } from '../test-support/miniTest';

const entry = (n: number) => ({ n, winner: 'SHIRTS' as const, side: 'CT' as const, condition: 'elim' as const });
const kill = (round_number: number, victim_player_id: number) => ({
  round_number, attacker_player_id: 1, victim_player_id, assister_player_id: null, weapon: 'ak47',
  headshot: false, noscope: false, wallbang: false, blind_kill: false, midair: false, is_teamkill: false, tick: 1,
});

function clean() {
  const parsed = {
    shirts_score: 2, skins_score: 0, warnings: [], stats: [], inferred_side: 'CT', effective_side: 'CT',
    round_history: [entry(1), entry(2)],
  } as unknown as ParsedDemoResult;
  const sab = {
    warnings: [],
    matchRounds: [1, 2].map((round_number) => ({ round_number, winner_side: 'CT', shirts_side: 'CT', win_reason: 'elim' })),
    matchKills: [kill(1, 7), kill(2, 7)],
  } as unknown as ParsedDemoSabremetricsResult;
  return { parsed, sab };
}
const expected = { shirts: 2, skins: 0, rounds: 2 };

test('checkDemoParseInvariants: a consistent parse has no violations', () => {
  const { parsed, sab } = clean();
  assert.deepEqual(checkDemoParseInvariants(parsed, sab, expected), []);
});

test('checkDemoParseInvariants: flags warnings, a wrong score and a wrong round count', () => {
  const { parsed, sab } = clean();
  parsed.warnings = ['side disagreement'];
  parsed.shirts_score = 1;
  const v = checkDemoParseInvariants(parsed, sab, { ...expected, rounds: 3 });
  assert.equal(v.length, 3);
});

test('checkDemoParseInvariants: flags a kill attributed to a non-live round', () => {
  const { parsed, sab } = clean();
  sab.matchKills.push(kill(9, 8));
  assert.match(checkDemoParseInvariants(parsed, sab, expected)[0], /round 9, which is not a live round/);
});

test('checkDemoParseInvariants: flags a player dying twice in one round', () => {
  const { parsed, sab } = clean();
  sab.matchKills.push(kill(1, 7));
  assert.match(checkDemoParseInvariants(parsed, sab, expected)[0], /dies twice in round 1/);
});

test('checkDemoParseInvariants: flags a non-contiguous round_history', () => {
  const { parsed, sab } = clean();
  parsed.round_history = [entry(1), entry(3)];
  assert.ok(checkDemoParseInvariants(parsed, sab, expected).some((v) => /not contiguous/.test(v)));
});

report();
