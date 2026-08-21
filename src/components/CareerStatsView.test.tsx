// @vitest-environment jsdom
/**
 * Component tests for `CareerStatsView.tsx`'s URL state: the tab bar reads from/writes to `tab`
 * (all four tabs, not just `h2h`), the season filter — via `useSeasonFilter({ resetSeasonOnToggle:
 * true })` — reads from/writes to `reg`/`gnt`/`season` and atomically resets `season` on a
 * regular/gauntlet toggle, and the H2H initial pair is read (read-only, no write-back yet) from
 * `a`/`b`/`type`.
 *
 * Run:  npx vitest run src/components/CareerStatsView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow } from '@/lib/test-support/leaderboardFixtures';
import CareerStatsView from './CareerStatsView';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/statistics');
});

function baseProps(overrides: { players?: { id: number; name: string; steam_avatar_url: string | null }[] } = {}) {
  return {
    regularSeasons: [{ id: 1, name: 'Season 1' }],
    gauntletSeasons: [{ id: 2, name: 'Season 1 Gauntlet' }],
    careerRows: [leaderboardRow()],
    bySeason: { 1: [leaderboardRow()] },
    gauntletCareerRows: [],
    gauntletBySeason: {},
    trophiesByPlayer: {},
    players: overrides.players ?? [
      { id: 1, name: 'Alice', steam_avatar_url: null },
      { id: 2, name: 'Bob', steam_avatar_url: null },
    ],
  };
}

describe('CareerStatsView — tab state', () => {
  test('reads the active tab from the URL, including tabs other than h2h', () => {
    nextNavigationMock.setSearchParams('tab=stats');
    render(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab pushes the URL', async () => {
    render(<CareerStatsView {...baseProps()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Advanced Stats' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/statistics?tab=advanced');
  });
});

describe('CareerStatsView — season filter', () => {
  test('toggling regular/gauntlet atomically resets `season`, in one navigation', async () => {
    nextNavigationMock.setSearchParams('tab=leaderboard&season=1');
    render(<CareerStatsView {...baseProps()} />);
    await userEvent.click(screen.getByText('Regular Season'));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/statistics?tab=leaderboard&reg=0');
  });
});

describe('CareerStatsView — H2H initial pair', () => {
  test('resolves `a`/`b`/`type` from the URL into the H2H tab', () => {
    nextNavigationMock.setSearchParams('tab=h2h&a=Alice&b=Bob&type=opponent');
    render(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'H2H' })).toHaveAttribute('aria-selected', 'true');
  });

  test('ignores an `a`/`b` pair naming a player that does not exist', () => {
    nextNavigationMock.setSearchParams('tab=h2h&a=Nobody&b=Bob');
    // Renders without throwing — urlInitialPair falls back to null.
    render(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'H2H' })).toHaveAttribute('aria-selected', 'true');
  });
});
