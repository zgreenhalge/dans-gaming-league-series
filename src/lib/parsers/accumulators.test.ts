/**
 * Unit tests for accumulators.ts's static prop/field maps. collectAccumulators() itself calls
 * parseTicks() against a real demo buffer, so it isn't unit-tested here (see the other parser
 * test files, which all take pre-parsed event rows) — this file guards the static wiring that
 * decides which engine accumulator feeds which SabFields column.
 *
 * Run:  npx tsx src/lib/parsers/accumulators.test.ts
 */

import assert from 'node:assert/strict';
import { SPLIT_PROPS, SPLIT_FIELDS, UNSPLIT_PROPS, UNSPLIT_FIELDS } from './accumulators';

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

test('accumulators: enemies_flashed is not read from the engine accumulator', () => {
  // enemies_flashed must come from utility.ts's half-blind-gated count (0.1), not the engine's
  // ungated m_iEnemiesFlashed netprop — re-adding it here would silently double-source the stat.
  assert.ok(!UNSPLIT_PROPS.includes('m_iEnemiesFlashed' as never));
  assert.ok(!Object.values(UNSPLIT_FIELDS).includes('enemies_flashed'));
});

test('accumulators: UNSPLIT_FIELDS only maps utility_damage', () => {
  assert.deepEqual(UNSPLIT_FIELDS, { m_iUtilityDamage: 'utility_damage' });
});

test('accumulators: every SPLIT_PROPS entry has a ct/t field mapping', () => {
  for (const prop of SPLIT_PROPS) {
    const fields = SPLIT_FIELDS[prop];
    assert.ok(fields, `missing SPLIT_FIELDS entry for ${prop}`);
    assert.ok(fields.ct, `missing ct field for ${prop}`);
    assert.ok(fields.t, `missing t field for ${prop}`);
  }
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
