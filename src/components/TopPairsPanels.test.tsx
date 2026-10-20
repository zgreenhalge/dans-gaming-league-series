// @vitest-environment jsdom
/**
 * Component tests for `TopPairsPanels.tsx`: Top duos and Hottest Rivalries each list the top three
 * career pairs, best first, with a stats preview per row (rating, games and W-L for a duo; matches
 * and rounds won on each side for a rivalry). The title links to the career H2H tab and every row to that
 * pair's career H2H matchup (`type=opponent` for rivalries); both render nothing when there are no
 * pairs.
 *
 * Run:  npx vitest run src/components/TopPairsPanels.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HottestRivalriesPanel, TopDuosPanel, TOP_PAIRS_LIMIT } from './TopPairsPanels';
import type { H2HData } from '@/lib/h2h';
import { duoStats } from '@/lib/test-support/h2hFixtures';

const PLAYERS = [1, 2, 3, 4, 5].map((id) => ({ id, name: `P${id}`, steam_avatar_url: null }));
const STATS = { kills: 20, assists: 5, deaths: 15, adr: 75, rwr: 57, roundsWon: 40, roundsPlayed: 70 };

function rival(playerA: number, playerB: number, aWins: number, bWins: number): H2HData['rivals'][number] {
  return {
    playerA,
    playerB,
    meetings: aWins + bWins,
    aWins,
    bWins,
    lastMap: null,
    aStats: { ...STATS, roundsWon: 13 * aWins },
    bStats: { ...STATS, roundsWon: 13 * bWins },
    mapBreakdown: [],
    matches: [],
  };
}

const DATA: H2HData = {
  players: PLAYERS,
  // P1&P2 are far ahead; P3&P4 and P4&P5 trail; P2&P5 is the fourth and must be cut.
  duos: [
    duoStats({ playerA: 1, playerB: 2, gamesPlayed: 10, wins: 9, losses: 1 }),
    duoStats({ playerA: 3, playerB: 4, gamesPlayed: 6, wins: 4, losses: 2 }),
    duoStats({ playerA: 4, playerB: 5, gamesPlayed: 4, wins: 2, losses: 2 }),
    duoStats({ playerA: 2, playerB: 5, gamesPlayed: 1, wins: 0, losses: 1 }),
  ],
  rivals: [
    rival(1, 2, 5, 5),
    rival(1, 3, 3, 3),
    rival(2, 4, 2, 2),
    rival(4, 5, 1, 0),
  ],
};

describe('TopDuosPanel', () => {
  test('the title links to the career H2H tab', () => {
    render(<TopDuosPanel data={DATA} />);
    expect(screen.getByRole('link', { name: 'Top duos' })).toHaveAttribute('href', '/statistics?tab=h2h');
  });

  test('lists the top three duos, best first, each linking to its career partner matchup', () => {
    render(<TopDuosPanel data={DATA} />);
    const rows = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.includes('&a='));
    expect(rows).toHaveLength(TOP_PAIRS_LIMIT);
    expect(rows[0]).toHaveAttribute('href', '/statistics?tab=h2h&a=P1&b=P2');
    expect(rows[0]).toHaveTextContent('P1 & P2');
    expect(rows[1]).toHaveAttribute('href', '/statistics?tab=h2h&a=P3&b=P4');
    expect(rows[2]).toHaveAttribute('href', '/statistics?tab=h2h&a=P4&b=P5');
    expect(screen.queryByText('P2 & P5')).toBeNull();
  });

  test('each row previews games, W-L and win rate — and leaves out the duo rounds column that does not fit', () => {
    render(<TopDuosPanel data={DATA} />);
    const first = screen.getAllByRole('link').find((l) => l.getAttribute('href')?.includes('&a=P1'))!;
    expect(within(first).getByText('10')).toBeInTheDocument();
    expect(within(first).getByText('9–1')).toBeInTheDocument();
    expect(within(first).getByText('90%')).toBeInTheDocument();
    expect(screen.queryByText('Rounds W-L')).toBeNull();
    expect(screen.getByText('Rating')).toBeInTheDocument();
  });

  test('renders nothing without a pair that has played', () => {
    const { container } = render(<TopDuosPanel data={{ ...DATA, duos: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HottestRivalriesPanel', () => {
  test('the title links to the career H2H tab', () => {
    render(<HottestRivalriesPanel data={DATA} />);
    expect(screen.getByRole('link', { name: 'Hottest Rivalries' })).toHaveAttribute('href', '/statistics?tab=h2h');
  });

  test('lists the top three rivalries, each linking to its career opponent matchup', () => {
    render(<HottestRivalriesPanel data={DATA} />);
    const rows = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.includes('&a='));
    expect(rows).toHaveLength(TOP_PAIRS_LIMIT);
    expect(rows[0]).toHaveAttribute('href', '/statistics?tab=h2h&a=P1&b=P2&type=opponent');
    expect(rows[0]).toHaveTextContent('P1');
    expect(rows[0]).toHaveTextContent('P2');
  });

  test('each row previews the rounds and matches each player won on either side of the rating', () => {
    render(<HottestRivalriesPanel data={DATA} />);
    const second = screen.getAllByRole('link').find((l) => l.getAttribute('href')?.includes('&a=P1&b=P3'))!;
    expect(within(second).getAllByText('3')).toHaveLength(2);
    expect(screen.getAllByText('Won')).toHaveLength(2);
    expect(screen.getAllByText('Rounds')).toHaveLength(2);
  });

  test('renders nothing without a rivalry', () => {
    const { container } = render(<HottestRivalriesPanel data={{ ...DATA, rivals: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a pair whose player is missing from the roster is skipped', () => {
    render(<HottestRivalriesPanel data={{ ...DATA, players: PLAYERS.filter((p) => p.id !== 1) }} />);
    expect(screen.queryByRole('link', { name: /P1/ })).toBeNull();
    expect(screen.getAllByRole('link').length).toBeGreaterThan(1);
  });
});
