/**
 * Unit tests for dathost-config.ts's pure cfg-parsing and diff logic (#163) — parseCfg and
 * compareCfg. diffGoldenConfig/pushCfgFiles hit the live DatHost API and local cfg files directly;
 * they're left as integration-only (exercised for real by scripts/dathost-golden-diff.ts and
 * scripts/dathost-golden-apply.ts against an actual server), the same "extract and test the pure
 * logic, leave IO-bound orchestration untested" split used elsewhere in this repo (e.g.
 * src/lib/demo/quarantine.test.ts).
 *
 * Run:  npx tsx src/lib/dathost-config.test.ts
 */

import assert from 'node:assert/strict';
import { parseCfg, compareCfg } from './dathost-config';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

// --- parseCfg ---

test('parseCfg reads a simple key-value cvar', () => {
  const map = parseCfg('mp_roundtime 1.92');
  assert.equal(map.get('mp_roundtime'), '1.92');
});

test('parseCfg skips blank lines and full-line // comments', () => {
  const map = parseCfg('// a comment\n\nmp_roundtime 1.92\n   \n// another\n');
  assert.deepEqual([...map.entries()], [['mp_roundtime', '1.92']]);
});

test('parseCfg strips a trailing semicolon from both key and value', () => {
  const withValue = parseCfg('mp_roundtime 1.92;');
  assert.equal(withValue.get('mp_roundtime'), '1.92');
  const keyOnly = parseCfg('exec foo;');
  assert.equal(keyOnly.get('exec'), 'foo');
});

test('parseCfg handles a key with no value', () => {
  const map = parseCfg('sv_cheats');
  assert.equal(map.get('sv_cheats'), '');
});

test('parseCfg normalizes CRLF line endings', () => {
  const map = parseCfg('mp_roundtime 1.92\r\nmp_freezetime 15\r\n');
  assert.equal(map.get('mp_roundtime'), '1.92');
  assert.equal(map.get('mp_freezetime'), '15');
});

test('parseCfg suffixes duplicate keys ([2], [3], ...) instead of overwriting', () => {
  const map = parseCfg('exec one\nexec two\nexec three\n');
  assert.equal(map.get('exec'), 'one');
  assert.equal(map.get('exec[2]'), 'two');
  assert.equal(map.get('exec[3]'), 'three');
});

test('parseCfg only strips full-line comments, not trailing "// ..." on a cvar line', () => {
  const map = parseCfg('mp_roundtime 1.92 // two rounds');
  assert.equal(map.get('mp_roundtime'), '1.92 // two rounds');
});

// --- compareCfg ---

test('compareCfg reports "match" when both sides agree', () => {
  const rows = compareCfg(new Map([['mp_roundtime', '1.92']]), new Map([['mp_roundtime', '1.92']]));
  assert.deepEqual(rows, [{ key: 'mp_roundtime', local: '1.92', live: '1.92', status: 'match' }]);
});

test('compareCfg reports "drift" when values differ', () => {
  const rows = compareCfg(new Map([['mp_roundtime', '1.92']]), new Map([['mp_roundtime', '1.5']]));
  assert.deepEqual(rows, [{ key: 'mp_roundtime', local: '1.92', live: '1.5', status: 'drift' }]);
});

test('compareCfg reports "missing" for a key only on the local (golden) side', () => {
  const rows = compareCfg(new Map([['mp_roundtime', '1.92']]), new Map());
  assert.deepEqual(rows, [{ key: 'mp_roundtime', local: '1.92', live: '(absent)', status: 'missing' }]);
});

test('compareCfg reports "missing" for a key only on the live side', () => {
  const rows = compareCfg(new Map(), new Map([['mp_roundtime', '1.92']]));
  assert.deepEqual(rows, [{ key: 'mp_roundtime', local: '(absent)', live: '1.92', status: 'missing' }]);
});

test('compareCfg sorts rows by key regardless of input order', () => {
  const rows = compareCfg(
    new Map([['zeta', '1'], ['alpha', '2']]),
    new Map([['zeta', '1'], ['alpha', '2']]),
  );
  assert.deepEqual(rows.map((r) => r.key), ['alpha', 'zeta']);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
