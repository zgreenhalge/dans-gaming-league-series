// @vitest-environment jsdom
/**
 * Component tests for `MyStatsPanel.tsx`: the EHOG / W-L / KDA / ADR tiles, the Next Match line,
 * the Best friend and Worst nightmare rows (each linking to the career H2H matchup — hidden when
 * there isn't one), the Match history list and its empty state, and the signed-out placeholder.
 *
 * Run:  npx vitest run src/components/MyStatsPanel.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ehogColorFor } from './EhogBadge';
import { MyStatsPanel, MyStatsLockedPanel } from './MyStatsPanel';
import type { MyStats } from '@/lib/queries';

function stats(overrides: Partial<MyStats> = {}): MyStats {
  return {
    playerId: 5,
    playerName: 'Rook',
    ehog: 23.46,
    record: { wins: 31, losses: 19 },
    kda: 1.4286,
    kd: 1.1,
    adr: 74.051,
    next: { matchId: 20, opponents: 'Bishop & Pixel', map: 'Harbor', scheduledAt: null },
    recent: [
      { matchId: 18, won: true, score: '13-6', opponents: 'Juno & Tango', map: 'harbor' },
      { matchId: 16, won: false, score: '8-13', opponents: 'Mav & Pixel', map: null },
    ],
    bestFriend: { id: 6, name: 'Tango', wins: 6, losses: 1 },
    worstNightmare: { id: 4, name: 'Mav', wins: 4, losses: 9 },
    ...overrides,
  };
}

describe('MyStatsPanel', () => {
  test('shows the player, their EHOG to one decimal, career record, KDA and ADR to two', () => {
    render(<MyStatsPanel stats={stats()} />);
    expect(screen.getByRole('link', { name: 'Rook' })).toHaveAttribute('href', '/players/5');
    expect(screen.getByText('23.5')).toBeInTheDocument();
    expect(screen.getByText('31-19')).toBeInTheDocument();
    expect(screen.getByText('1.43', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1.10 K/D')).toBeInTheDocument();
    expect(screen.getByText('74.05')).toBeInTheDocument();
  });

  test('the EHOG figure takes the rating tier color', () => {
    render(<MyStatsPanel stats={stats()} />);
    expect(screen.getByText('23.5')).toHaveStyle({ color: ehogColorFor(23.46) });
  });

  test('a player with no played matches or rating shows dashes instead of the figures', () => {
    render(<MyStatsPanel stats={stats({ ehog: null, record: { wins: 0, losses: 0 }, kda: 0, kd: 0, adr: 0, recent: [], next: null })} />);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  test('Best friend and Worst nightmare link to the career H2H matchup, partner and opponent', () => {
    render(<MyStatsPanel stats={stats()} />);
    const friend = screen.getByRole('link', { name: /Best friend/ });
    expect(friend).toHaveAttribute('href', '/statistics?tab=h2h&a=Rook&b=Tango');
    expect(within(friend).getByText('Tango')).toBeInTheDocument();
    expect(within(friend).getByText('6-1')).toBeInTheDocument();

    const nightmare = screen.getByRole('link', { name: /Worst nightmare/ });
    expect(nightmare).toHaveAttribute('href', '/statistics?tab=h2h&a=Rook&b=Mav&type=opponent');
    expect(within(nightmare).getByText('4-9')).toBeInTheDocument();
  });

  test('a missing best friend or worst nightmare is left out rather than shown empty', () => {
    render(<MyStatsPanel stats={stats({ bestFriend: null, worstNightmare: null })} />);
    expect(screen.queryByText('Best friend')).toBeNull();
    expect(screen.queryByText('Worst nightmare')).toBeNull();
  });

  test('Next Match links to the match with its opponents', () => {
    render(<MyStatsPanel stats={stats()} />);
    const next = screen.getByRole('link', { name: /Next Match/ });
    expect(next).toHaveAttribute('href', '/matches/20');
    expect(next).toHaveTextContent('Bishop & Pixel');
    expect(next).toHaveTextContent('Harbor');
  });

  test('no upcoming match shows no Next Match line', () => {
    render(<MyStatsPanel stats={stats({ next: null })} />);
    expect(screen.queryByText('Next Match')).toBeNull();
  });

  test('Match history lists each played match as a result chip, stored score and opponents, linking to the match', () => {
    render(<MyStatsPanel stats={stats()} />);
    const win = screen.getByRole('link', { name: /13-6/ });
    expect(win).toHaveAttribute('href', '/matches/18');
    expect(within(win).getByLabelText('Win')).toHaveTextContent('W');
    expect(win).toHaveTextContent('vs Juno & Tango');
    expect(win).toHaveTextContent('Harbor');
    const loss = screen.getByRole('link', { name: /8-13/ });
    expect(within(loss).getByLabelText('Loss')).toHaveTextContent('L');
    expect(screen.getByRole('link', { name: 'View all →' })).toHaveAttribute('href', '/players/5?tab=matches');
  });

  test('no recent matches shows the empty state', () => {
    render(<MyStatsPanel stats={stats({ recent: [] })} />);
    expect(screen.getByText('No recent matches')).toBeInTheDocument();
  });
});

describe('MyStatsLockedPanel', () => {
  test('prompts a Login that goes to the Steam sign-in route', () => {
    render(<MyStatsLockedPanel />);
    expect(screen.getByText('Login to see your stats')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/api/auth/steam');
  });

  test('its placeholder is hidden from assistive tech and carries no real player or match links', () => {
    const { container } = render(<MyStatsLockedPanel />);
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /players|matches/i })).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });
});
