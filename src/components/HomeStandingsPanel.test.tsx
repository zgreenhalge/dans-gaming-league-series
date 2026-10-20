// @vitest-environment jsdom
/**
 * Component tests for `HomeStandingsPanel.tsx`: the season title and "View all →" link, the Live /
 * Final pill (and the gauntlet pill), a player link per row, the Form column's colored W / L
 * letters, dashes for a player who hasn't played, and the empty state.
 *
 * Run:  npx vitest run src/components/HomeStandingsPanel.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createNextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { HomeStandingsPanel, FormCell } from './HomeStandingsPanel';
import type { LeaderboardRowWithId } from '@/lib/types';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => {
  resetNextNavigationMock();
});

function row(playerId: number, name: string, overrides: Partial<LeaderboardRowWithId> = {}): LeaderboardRowWithId {
  return {
    season_id: 4,
    player_id: playerId,
    player_name: name,
    matches_played: 20,
    matches_won: 14,
    matches_lost: 6,
    win_rate_percentage: 70,
    total_kills: 0,
    total_assists: 0,
    total_deaths: 0,
    kd_ratio: 1,
    total_damage: 0,
    total_rounds_played: 400,
    total_rounds_won: 233,
    rwr_percentage: 58.25,
    overall_adr: 84.123,
    kills_in_wins: 0,
    deaths_in_wins: 0,
    kills_in_losses: 0,
    deaths_in_losses: 0,
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof HomeStandingsPanel>> = {}) {
  return render(
    <HomeStandingsPanel
      title="Season 4"
      seasonHref="/seasons/4"
      live
      rows={[row(2, 'Kestrel'), row(5, 'Rook', { matches_won: 11, matches_lost: 9 })]}
      form={new Map([[2, [true, true, false, true, true]], [5, [false]]])}
      currentPlayerId={null}
      {...props}
    />,
  );
}

describe('HomeStandingsPanel', () => {
  test('the title and "View all →" both link to the season', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: 'Season 4' })).toHaveAttribute('href', '/seasons/4');
    expect(screen.getByRole('link', { name: 'View all →' })).toHaveAttribute('href', '/seasons/4');
  });

  test('a running season shows Live, a finished one Final', () => {
    const { rerender } = renderPanel();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByText('Final')).toBeNull();

    rerender(
      <HomeStandingsPanel title="Season 3" seasonHref="/seasons/3" live={false} rows={[row(2, 'Kestrel')]} form={new Map()} currentPlayerId={null} />,
    );
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
  });

  test('a running gauntlet adds a pill linking to it', () => {
    renderPanel({ gauntletHref: '/seasons/4?view=gauntlet' });
    expect(screen.getByRole('link', { name: 'Gauntlet live' })).toHaveAttribute('href', '/seasons/4?view=gauntlet');
  });

  test('each row links to its player, in the order given, with the record, RWR% and ADR', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: 'Kestrel' })).toHaveAttribute('href', '/players/2');
    expect(screen.getByRole('link', { name: 'Rook' })).toHaveAttribute('href', '/players/5');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('14-6')).toBeInTheDocument();
    expect(within(rows[0]).getByText('58.3%')).toBeInTheDocument();
    expect(within(rows[0]).getByText('84.12')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2')).toBeInTheDocument();
  });

  test('Form shows each player\'s results as W / L letters, newest first', () => {
    renderPanel();
    const kestrel = screen.getByLabelText('Last 5: win, win, loss, win, win');
    expect(kestrel).toHaveTextContent('WWLWW');
    expect(screen.getByLabelText('Last 1: loss')).toHaveTextContent('L');
  });

  test('FormCell: wins are green and losses red; no results is a dash', () => {
    const { container, rerender } = render(<FormCell results={[true, false]} />);
    const [w, l] = Array.from(container.querySelectorAll('span > span')) as HTMLElement[];
    expect(w).toHaveStyle({ color: 'var(--color-accent-green-fg)' });
    expect(l).toHaveStyle({ color: 'var(--color-accent-red-fg)' });
    rerender(<FormCell results={[]} />);
    expect(container).toHaveTextContent('—');
  });

  test('a rostered player who has not played shows dashes and an empty Form', () => {
    renderPanel({
      rows: [row(7, 'Grace', { matches_played: 0, matches_won: 0, matches_lost: 0, total_rounds_played: 0 })],
      form: new Map(),
    });
    expect(within(screen.getAllByRole('row')[1]).getAllByText('—')).toHaveLength(4);
  });

  test('the current player\'s name is highlighted', () => {
    const { container } = renderPanel({ currentPlayerId: 5 });
    expect(container.querySelectorAll('.player-name-me')).toHaveLength(1);
    expect(container.querySelector('.player-name-me')).toHaveTextContent('Rook');
  });

  test('no rows shows the empty state instead of a table', () => {
    renderPanel({ rows: [] });
    expect(screen.getByText('No standings yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
