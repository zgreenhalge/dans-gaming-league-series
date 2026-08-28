/**
 * Unit tests for accumulators.ts's static prop/field maps. collectAccumulators() itself calls
 * parseTicks() against a real demo buffer, so it isn't unit-tested here (see the other parser
 * test files, which all take pre-parsed event rows) — this file guards the static wiring that
 * decides which engine accumulator feeds which SabFields column.
 *
 * Run:  npx vitest run src/lib/parsers/accumulators.test.ts
 */

import assert from 'node:assert/strict';
import { SPLIT_PROPS, SPLIT_FIELDS, UNSPLIT_FIELDS } from './accumulators';
import { test, report } from '../test-support/miniTest';

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

report();
