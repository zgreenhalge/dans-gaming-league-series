// @vitest-environment jsdom
/**
 * Component tests for `CareerStatsView.tsx`'s URL state: the tab bar reads from/writes to `tab`
 * (all four tabs, not just `h2h`), the season filter — via `useSeasonFilter({ resetSeasonOnToggle:
 * true })` — reads from/writes to `reg`/`gnt`/`season` and atomically resets `season` on a
 * regular/gauntlet toggle, and the H2H pair reads from and writes back to `a`/`b`/`type`.
 *
 * Run:  npx vitest run src/components/CareerStatsView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow } from '@/lib/test-support/leaderboardFixtures';
import { H2H_PLAYERS } from '@/lib/test-support/h2hFixtures';
import CareerStatsView from './CareerStatsView';
import type { MapMatchRow, MapPlayerStat } from '@/lib/queries';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/statistics');
});

function playerStat(overrides: Partial<MapPlayerStat> = {}): MapPlayerStat {
  return {
    player_id: 1,
    player_name: 'Alice',
    faction: 'SHIRTS',
    kills: 20,
    assists: 5,
    deaths: 15,
    adr: 75,
    damage: 1000,
    rounds_played: 13,
    rounds_won: 8,
    is_win: true,
    ...overrides,
  };
}

function matchRow(overrides: Partial<MapMatchRow> = {}): MapMatchRow {
  return {
    match_id: 1,
    match_number: 1,
    week_number: 1,
    season_id: 1,
    season_number: 1,
    season_name: 'Season 1',
    is_gauntlet: false,
    is_playoff_game: false,
    final_score: '13-9',
    shirts_stats: [],
    skins_stats: [],
    picked_map: null,
    shirts_pick: null,
    skins_starting_side: null,
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    map_pool: null,
    ...overrides,
  };
}

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

  test('clicking a duo row writes `a`/`b` (and omits the default `type`)', async () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    render(
      <CareerStatsView
        {...baseProps({
          players: H2H_PLAYERS,
          allMatches: [
            matchRow({
              shirts_stats: [
                playerStat({ player_id: 1, player_name: 'Alice' }),
                playerStat({ player_id: 2, player_name: 'Bob' }),
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
