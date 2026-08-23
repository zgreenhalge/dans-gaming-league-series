// @vitest-environment jsdom
/**
 * Component tests for `CareerStatsView.tsx`'s URL state: the tab bar reads from/writes to `tab`
 * (all four tabs, not just `h2h`), the season filter — via `useSeasonFilter({ regularSeasons,
 * gauntletSeasons })` — reads from/writes to `reg`/`gnt`/`season`, self-correcting a `season`
 * selection that's no longer valid under the current include-flags at read time rather than writing
 * it back out, and the H2H pair reads from and writes back to `a`/`b`/`type`.
 *
 * Run:  npx vitest run src/components/CareerStatsView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { renderWithUrlState } from '@/lib/test-support/renderWithUrlState';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow } from '@/lib/test-support/leaderboardFixtures';
import { H2H_PLAYERS, h2hPlayerStat, h2hMatchRow } from '@/lib/test-support/h2hFixtures';
import CareerStatsView from './CareerStatsView';
import type { MapMatchRow } from '@/lib/queries';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/statistics');
});

function baseProps(overrides: {
  players?: { id: number; name: string; steam_avatar_url: string | null }[];
  allMatches?: MapMatchRow[];
} = {}) {
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
    allMatches: overrides.allMatches ?? [],
  };
}

describe('CareerStatsView — tab state', () => {
  test('reads the active tab from the URL, including tabs other than h2h', () => {
    nextNavigationMock.setSearchParams('tab=stats');
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab pushes the URL', async () => {
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Advanced Stats' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/statistics?tab=advanced');
  });
});

describe('CareerStatsView — season filter', () => {
  test('toggling regular/gauntlet writes only `reg`/`gnt`, in one navigation, leaving `season` in the URL', async () => {
    nextNavigationMock.setSearchParams('tab=leaderboard&season=1');
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    await userEvent.click(screen.getByText('Regular Season'));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    // `season=1` is left in place — a stale value there self-corrects at read time on the next
    // render (via `useSeasonFilter`'s `regularSeasons` clamp) instead of being written back out.
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/statistics?tab=leaderboard&season=1&reg=0');
  });

  test('a `season` id no longer valid under the current include-flags falls back to "Career" without rewriting the URL', () => {
    // `season=1` names a regular season, but `reg=0` excludes regular seasons.
    nextNavigationMock.setSearchParams('tab=leaderboard&reg=0&season=1');
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('combobox')).toHaveValue('all');
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
  });
});

describe('CareerStatsView — H2H initial pair', () => {
  test('resolves `a`/`b`/`type` from the URL into the H2H tab', () => {
    nextNavigationMock.setSearchParams('tab=h2h&a=Alice&b=Bob&type=opponent');
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'H2H' })).toHaveAttribute('aria-selected', 'true');
  });

  test('ignores an `a`/`b` pair naming a player that does not exist', () => {
    nextNavigationMock.setSearchParams('tab=h2h&a=Nobody&b=Bob');
    // Renders without throwing — urlInitialPair falls back to null.
    renderWithUrlState(<CareerStatsView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'H2H' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a duo row writes `a`/`b` (and omits the default `type`)', async () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    renderWithUrlState(
      <CareerStatsView
        {...baseProps({
          players: H2H_PLAYERS,
          allMatches: [
            h2hMatchRow({
              shirts_stats: [
                h2hPlayerStat({ player_id: 1, player_name: 'Alice' }),
                h2hPlayerStat({ player_id: 2, player_name: 'Bob' }),
              ],
            }),
          ],
        })}
      />,
    );
    await userEvent.click(screen.getAllByText('Alice & Bob')[0]);

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/statistics?tab=h2h&a=Alice&b=Bob');
  });
});
