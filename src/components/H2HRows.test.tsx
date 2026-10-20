// @vitest-environment jsdom
/**
 * Component tests for `H2HRows.tsx`: the ranked duo / rivalry rows shared by `H2HSection` and the
 * home page. A row is a link when given an `href` and a selectable row (click selects, hover
 * previews) otherwise; `compact` drops the round figures and a rivalry's avatars.
 *
 * Run:  npx vitest run src/components/H2HRows.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuoHeader, DuoRow, RivalHeader, RivalRow } from './H2HRows';
import { duoStats, H2H_PLAYERS } from '@/lib/test-support/h2hFixtures';
import type { H2HStats } from '@/lib/h2h';

const [alice, bob] = H2H_PLAYERS;

const STATS = { kills: 20, assists: 5, deaths: 15, adr: 75, rwr: 57, roundsWon: 40, roundsPlayed: 70 };
const RIVAL: H2HStats = {
  playerA: 1,
  playerB: 2,
  meetings: 7,
  aWins: 4,
  bWins: 3,
  lastMap: null,
  aStats: { ...STATS, roundsWon: 55 },
  bStats: { ...STATS, roundsWon: 51 },
  mapBreakdown: [],
  matches: [],
};

describe('DuoRow', () => {
  const props = { rank: 1, duo: duoStats(), rating: 88, breakdown: 'tip', a: alice, b: bob };

  test('shows the pair, games, W-L with win rate and rounds W-L with round win rate', () => {
    render(<DuoRow {...props} />);
    expect(screen.getByText('Alice & Bob')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3–2')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('40–30')).toBeInTheDocument();
    expect(screen.getByText('57%')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  test('compact leaves out the rounds column and its header', () => {
    const { rerender } = render(
      <>
        <DuoHeader />
        <DuoRow {...props} />
      </>,
    );
    expect(screen.getByText('Rounds W-L')).toBeInTheDocument();
    rerender(
      <>
        <DuoHeader compact />
        <DuoRow {...props} compact />
      </>,
    );
    expect(screen.queryByText('Rounds W-L')).toBeNull();
    expect(screen.queryByText('40–30')).toBeNull();
    expect(screen.getByText('3–2')).toBeInTheDocument();
  });

  test('with an href the row is a link', () => {
    render(<DuoRow {...props} href="/statistics?tab=h2h&a=Alice&b=Bob" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/statistics?tab=h2h&a=Alice&b=Bob');
  });

  test('without an href a click selects and hover previews', async () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    render(<DuoRow {...props} onSelect={onSelect} onHover={onHover} />);
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.hover(screen.getByText('Alice & Bob'));
    expect(onHover).toHaveBeenLastCalledWith(true);
    await userEvent.unhover(screen.getByText('Alice & Bob'));
    expect(onHover).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByText('Alice & Bob'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('RivalRow', () => {
  const props = { rival: RIVAL, rating: 91, breakdown: 'tip', a: alice, b: bob };

  test('shows both players, matches won on each side, round figures and the rating', () => {
    render(
      <>
        <RivalHeader />
        <RivalRow {...props} />
      </>,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('51')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getAllByText('Rounds')).toHaveLength(2);
  });

  test('accents the higher figure of each pair', () => {
    render(<RivalRow {...props} />);
    expect(screen.getByText('4')).toHaveClass('text-[var(--color-site-accent)]');
    expect(screen.getByText('3')).toHaveClass('text-[var(--color-text-secondary)]');
  });

  test('compact leaves out the round figures', () => {
    render(
      <>
        <RivalHeader compact />
        <RivalRow {...props} compact />
      </>,
    );
    expect(screen.queryByText('55')).toBeNull();
    expect(screen.queryByText('Rounds')).toBeNull();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  test('with an href the row is a link; without one a click selects', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RivalRow {...props} href="/statistics?tab=h2h&a=Alice&b=Bob&type=opponent" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/statistics?tab=h2h&a=Alice&b=Bob&type=opponent');
    rerender(<RivalRow {...props} onSelect={onSelect} />);
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
