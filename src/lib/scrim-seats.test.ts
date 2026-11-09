/**
 * Scrim night fill: signup counts, how full a night is, and which of a day's nights speaks for it.
 *
 * Run:  npx vitest run src/lib/scrim-seats.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { dayNightFill, leadNight, nightFill, signupCounts } from './scrim-seats';
import type { ScrimCommitment } from './scrim-schedule';

const signups = (definite: number, maybe: number) => [
  ...Array.from({ length: definite }, () => ({ commitment: 'definite' as ScrimCommitment })),
  ...Array.from({ length: maybe }, () => ({ commitment: 'maybe' as ScrimCommitment })),
];

test('signupCounts splits definite from maybe', () => {
  assert.deepEqual(signupCounts(signups(3, 2)), { definite: 3, maybe: 2 });
});

test('nightFill: full at four definite, could-fill when maybes reach four, else short', () => {
  assert.equal(nightFill(4, 0), 'full');
  assert.equal(nightFill(2, 2), 'could-fill');
  assert.equal(nightFill(2, 1), 'short');
});

test('leadNight: most definite, then most maybes; null with no nights', () => {
  assert.equal(leadNight([]), null);
  assert.deepEqual(leadNight([{ definite: 2, maybe: 3 }, { definite: 3, maybe: 0 }, { definite: 3, maybe: 1 }]), { definite: 3, maybe: 1 });
});

test('dayNightFill: the lead night colours the day, totals span every night; no nights is short', () => {
  assert.deepEqual(dayNightFill([]), { lead: null, fill: 'short', total: { definite: 0, maybe: 0 } });
  assert.deepEqual(dayNightFill([{ signups: signups(1, 1) }, { signups: signups(2, 2) }]), {
    lead: { definite: 2, maybe: 2 },
    fill: 'could-fill',
    total: { definite: 3, maybe: 3 },
  });
});

report();
