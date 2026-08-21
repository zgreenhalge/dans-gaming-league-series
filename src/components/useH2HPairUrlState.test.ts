/**
 * Tests for `useH2HPairUrlState.ts`'s pure `a`/`b`/`type` <-> `H2HPair` serialization helpers
 * (`parseH2HPairFromParams`/`h2hPairToParams`) — the hook itself is exercised end-to-end via each
 * call site's own tests (`CareerStatsView.test.tsx`, `MapDetailView.test.tsx`,
 * `SeasonTabView.test.tsx`) and `H2HSection.test.tsx`'s `onPairChange` callback tests.
 *
 * Run:  npx vitest run src/components/useH2HPairUrlState.test.ts
 */

import { describe, expect, test } from 'vitest';
import { parseH2HPairFromParams, h2hPairToParams } from './useH2HPairUrlState';
import { H2H_PLAYERS } from '@/lib/test-support/h2hFixtures';

describe('parseH2HPairFromParams', () => {
  test('resolves `a`/`b`/`type` (case-insensitive) into ids', () => {
    const params = new URLSearchParams('a=alice&b=BOB&type=opponent');
    expect(parseH2HPairFromParams(params, H2H_PLAYERS)).toEqual({ a: 1, b: 2, type: 'opponent' });
  });

  test('defaults `type` to "partner" when absent', () => {
    const params = new URLSearchParams('a=Alice&b=Bob');
    expect(parseH2HPairFromParams(params, H2H_PLAYERS)).toEqual({ a: 1, b: 2, type: 'partner' });
  });

  test('returns null when `a` or `b` is missing', () => {
    expect(parseH2HPairFromParams(new URLSearchParams('a=Alice'), H2H_PLAYERS)).toBeNull();
    expect(parseH2HPairFromParams(new URLSearchParams(''), H2H_PLAYERS)).toBeNull();
  });

  test('returns null when a name does not match a known player', () => {
    expect(parseH2HPairFromParams(new URLSearchParams('a=Nobody&b=Bob'), H2H_PLAYERS)).toBeNull();
  });
});

describe('h2hPairToParams', () => {
  test('resolves ids to names, omitting `type` for the default "partner"', () => {
    expect(h2hPairToParams({ a: 1, b: 2, type: 'partner' }, H2H_PLAYERS)).toEqual({
      a: 'Alice',
      b: 'Bob',
      type: undefined,
    });
  });

  test('includes `type` for "opponent"', () => {
    expect(h2hPairToParams({ a: 1, b: 2, type: 'opponent' }, H2H_PLAYERS)).toEqual({
      a: 'Alice',
      b: 'Bob',
      type: 'opponent',
    });
  });

  test('resolves an unknown id to an undefined name', () => {
    expect(h2hPairToParams({ a: 99, b: 2, type: 'partner' }, H2H_PLAYERS)).toEqual({
      a: undefined,
      b: 'Bob',
      type: undefined,
    });
  });
});
