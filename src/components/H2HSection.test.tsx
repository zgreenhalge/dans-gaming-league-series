// @vitest-environment jsdom
/**
 * Tests for `H2HSection.tsx`'s URL-pair helpers (`parseH2HPairFromParams`/`h2hPairToParams`) and its
 * `onPairChange` callback — fired on every explicit selection (a row click, a matrix cell click, a
 * flip button), never on a hover preview, so a parent can mirror the active pair into its own URL
 * state without this component knowing anything about routing.
 *
 * Run:  npx vitest run src/components/H2HSection.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import H2HSection, { parseH2HPairFromParams, h2hPairToParams } from './H2HSection';
import { H2H_PLAYERS, h2hDataWithDuo } from '@/lib/test-support/h2hFixtures';

const PLAYERS = H2H_PLAYERS;
const h2hData = h2hDataWithDuo;

describe('parseH2HPairFromParams', () => {
  test('resolves `a`/`b`/`type` (case-insensitive) into ids', () => {
    const params = new URLSearchParams('a=alice&b=BOB&type=opponent');
    expect(parseH2HPairFromParams(params, PLAYERS)).toEqual({ a: 1, b: 2, type: 'opponent' });
  });

  test('defaults `type` to "partner" when absent', () => {
    const params = new URLSearchParams('a=Alice&b=Bob');
    expect(parseH2HPairFromParams(params, PLAYERS)).toEqual({ a: 1, b: 2, type: 'partner' });
  });

  test('returns null when `a` or `b` is missing', () => {
    expect(parseH2HPairFromParams(new URLSearchParams('a=Alice'), PLAYERS)).toBeNull();
    expect(parseH2HPairFromParams(new URLSearchParams(''), PLAYERS)).toBeNull();
  });

  test('returns null when a name does not match a known player', () => {
    expect(parseH2HPairFromParams(new URLSearchParams('a=Nobody&b=Bob'), PLAYERS)).toBeNull();
  });
});

describe('h2hPairToParams', () => {
  test('resolves ids to names, omitting `type` for the default "partner"', () => {
    expect(h2hPairToParams({ a: 1, b: 2, type: 'partner' }, PLAYERS)).toEqual({
      a: 'Alice',
      b: 'Bob',
      type: undefined,
    });
  });

  test('includes `type` for "opponent"', () => {
    expect(h2hPairToParams({ a: 1, b: 2, type: 'opponent' }, PLAYERS)).toEqual({
      a: 'Alice',
      b: 'Bob',
      type: 'opponent',
    });
  });

  test('resolves an unknown id to an undefined name', () => {
    expect(h2hPairToParams({ a: 99, b: 2, type: 'partner' }, PLAYERS)).toEqual({
      a: undefined,
      b: 'Bob',
      type: undefined,
    });
  });
});

describe('H2HSection — onPairChange', () => {
  test('fires on an explicit row click, with the clicked pair', async () => {
    const onPairChange = vi.fn();
    render(<H2HSection data={h2hData()} onPairChange={onPairChange} />);
    await userEvent.click(screen.getAllByText('Alice & Bob')[0]);

    expect(onPairChange).toHaveBeenCalledWith({ a: 1, b: 2, type: 'partner' });
  });

  test('does not fire on hover', async () => {
    const onPairChange = vi.fn();
    render(<H2HSection data={h2hData()} onPairChange={onPairChange} />);
    await userEvent.hover(screen.getAllByText('Alice & Bob')[0]);

    expect(onPairChange).not.toHaveBeenCalled();
  });
});
