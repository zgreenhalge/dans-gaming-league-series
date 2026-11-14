/**
 * `scrimConflictResponse()`: a refused scrim match write is a 409 (with the reload code when the match
 * moved on), and any other error is left to the caller.
 *
 * Run:  npx vitest run src/lib/scrim-route-errors.test.ts
 */

import { expect, test } from 'vitest';
import { scrimConflictResponse } from './scrim-route-errors';
import { SCRIM_MATCH_CHANGED_CODE, ScrimMatchChangedError, ScrimMatchConflictError } from './scrim-matches';

test('a match that moved on is a 409 with the reload code', async () => {
  const res = scrimConflictResponse(new ScrimMatchChangedError())!;
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'This match was changed — reloaded', code: SCRIM_MATCH_CHANGED_CODE });
});

test('any other refusal is a 409 with its message and no code', async () => {
  const res = scrimConflictResponse(new ScrimMatchConflictError('Finish or discard the current match first.'))!;
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'Finish or discard the current match first.' });
});

test('anything else is left to the caller', () => {
  for (const other of [new Error('connection reset'), { code: 'TEST', message: 'plain object' }, 'text', null, undefined]) {
    expect(scrimConflictResponse(other)).toBeNull();
  }
});
