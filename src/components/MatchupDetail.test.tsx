// @vitest-environment jsdom
/**
 * Component tests for `MatchupDetail.tsx`'s performance cells: a duo's wins above the pre-match odds,
 * ADR lift and KDA, and a rivalry's upsets and evenness, plus the dimmed rating on an uneven
 * rivalry.
 *
 * Run:  npx vitest run src/components/MatchupDetail.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DuoDetail, RivalDetail } from './MatchupDetail';
import { duoStats, H2H_PLAYERS } from '@/lib/test-support/h2hFixtures';
import type { H2HStats } from '@/lib/h2h';

const players = new Map(H2H_PLAYERS.map((p) => [p.id, p]));
const STATS = { kills: 20, assists: 5, deaths: 15, adr: 75, rwr: 57, roundsWon: 40, roundsPlayed: 70 };

function rival(overrides: Partial<H2HStats> = {}): H2HStats {
  return {
    playerA: 1,
    playerB: 2,
    meetings: 6,
    aWins: 3,
    bWins: 3,
    lastMap: null,
    aStats: STATS,
    bStats: STATS,
    mapBreakdown: [],
    matches: [],
    aUpsetScore: 0,
    bUpsetScore: 0,
    aUpsetWins: 2,
    bUpsetWins: 1,
    ...overrides,
  };
}

describe('DuoDetail', () => {
  test('shows wins above the odds, ADR lift and the average KDA', () => {
    render(<DuoDetail duo={duoStats({ gamesPlayed: 5, wins: 4, winsAboveExpected: 1.46, adrLift: 0.102 })} players={players} />);
    expect(screen.getByText('vs Odds').parentElement).not.toHaveClass('opacity-50');
    expect(screen.getByText('+1.5')).toBeInTheDocument();
    expect(screen.getByText('+10%')).toBeInTheDocument();
    expect(screen.getByText('1.67')).toBeInTheDocument();
    expect(screen.getByTitle('Won 4; the pre-match odds predicted 2.5')).toBeInTheDocument();
  });

  test('dims the odds and lift cells under three games together', () => {
    render(<DuoDetail duo={duoStats({ gamesPlayed: 2, wins: 1, winsAboveExpected: -0.4, adrLift: -0.03 })} players={players} />);
    expect(screen.getByText('vs Odds').parentElement).toHaveClass('opacity-50');
    expect(screen.getByText('ADR lift').parentElement).toHaveClass('opacity-50');
    expect(screen.getByText('-0.4')).toBeInTheDocument();
    expect(screen.getByText('-3%')).toBeInTheDocument();
  });
});

describe('RivalDetail', () => {
  test('shows each side\'s upset wins and the record\'s evenness', () => {
    render(<RivalDetail rival={rival({ aWins: 4, bWins: 2 })} players={players} />);
    expect(screen.getByText('2–1')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument(); // 1 − 2 / 6
  });

  test('dims the rating of an uneven rivalry, but not an even one or an unrated one', () => {
    const { rerender } = render(<RivalDetail rival={rival({ aWins: 5, bWins: 1 })} players={players} rivalryRating={40} ratingBreakdown="tip" />);
    expect(screen.getByTitle('tip · Uneven record')).toHaveClass('opacity-40');
    rerender(<RivalDetail rival={rival()} players={players} rivalryRating={90} ratingBreakdown="tip" />);
    expect(screen.getByTitle('tip')).not.toHaveClass('opacity-40');
    rerender(<RivalDetail rival={rival({ aWins: 5, bWins: 1 })} players={players} />);
    expect(screen.queryByTitle(/Uneven record/)).toBeNull();
  });
});
