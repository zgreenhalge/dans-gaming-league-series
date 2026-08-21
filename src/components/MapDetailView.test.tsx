// @vitest-environment jsdom
/**
 * Component tests for `MapDetailView.tsx`'s URL state: the tab bar reads from/writes to `tab`, and
 * the season filter — via the shared `useSeasonFilter()` — reads from/writes to `reg`/`gnt`/`season`
 * without resetting `season` on a regular/gauntlet toggle (unlike `PlayerView`, this view doesn't opt
 * into `resetSeasonOnToggle`; it relies on `SeasonFilter`'s own conditional-reset effect instead).
 *
 * Run:  npx vitest run src/components/MapDetailView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { H2H_PLAYERS } from '@/lib/test-support/h2hFixtures';
import MapDetailView from './MapDetailView';
import type { MapMatchRow, MapDetail, MapPlayerStat } from '@/lib/queries';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/maps/de_dust2');
});

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

function baseDetail(overrides: Partial<MapDetail> = {}): MapDetail {
  return {
    name: 'de_dust2',
    slug: 'de_dust2',
    pickCount: 1,
    banCount: 0,
    noPickCount: 0,
    seasons: [{ id: 1, name: 'Season 1', is_gauntlet: false }],
    matches: [matchRow()],
    playerStats: [],
    ...overrides,
  };
}

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

const players: { id: number; name: string; steam_avatar_url: string | null }[] = [];

describe('MapDetailView — tab state', () => {
  test('reads the active tab from the URL', () => {
    nextNavigationMock.setSearchParams('tab=matches');
    render(<MapDetailView detail={baseDetail()} players={players} />);
    expect(screen.getByRole('tab', { name: /Matches/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab pushes the URL', async () => {
    render(<MapDetailView detail={baseDetail()} players={players} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/maps/de_dust2?tab=stats');
  });
});

describe('MapDetailView — season filter', () => {
  test('reads a specific `season` id and filters matches accordingly', () => {
    nextNavigationMock.setSearchParams('season=1');
    const detail = baseDetail({
      seasons: [
        { id: 1, name: 'Season 1', is_gauntlet: false },
        { id: 2, name: 'Season 2', is_gauntlet: false },
      ],
      matches: [matchRow({ season_id: 1 }), matchRow({ match_id: 2, season_id: 2, season_name: 'Season 2' })],
    });
    render(<MapDetailView detail={detail} players={players} />);
    expect(screen.getByRole('tab', { name: /Matches/ }).textContent).toContain('(1)');
  });

  test('toggling regular/gauntlet does not touch `season` (no resetSeasonOnToggle)', async () => {
    // Two seasons sharing a title so the dropdown renders (SeasonFilter hides it at <=1 unique
    // season) — the Checkbox's label span has its own onClick, so click that directly (a
    // pre-existing a11y gap, not introduced here — see SeasonFilter.test.tsx).
    nextNavigationMock.setSearchParams('season=1');
    const detail = baseDetail({
      seasons: [
        { id: 1, name: 'Season 1', is_gauntlet: false },
        { id: 2, name: 'Season 2', is_gauntlet: false },
      ],
      matches: [matchRow({ season_id: 1 }), matchRow({ match_id: 2, season_id: 2, season_name: 'Season 2' })],
    });
    render(<MapDetailView detail={detail} players={players} />);
    await userEvent.click(screen.getByText('Regular Season'));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/maps/de_dust2?season=1&reg=0');
  });
});

describe('MapDetailView — H2H pair writes to the URL', () => {
  test('clicking a duo row writes `a`/`b` (and omits the default `type`)', async () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const detail = baseDetail({
      matches: [
        matchRow({
          shirts_stats: [
            playerStat({ player_id: 1, player_name: 'Alice' }),
            playerStat({ player_id: 2, player_name: 'Bob' }),
          ],
        }),
      ],
    });
    render(<MapDetailView detail={detail} players={H2H_PLAYERS} />);
    await userEvent.click(screen.getAllByText('Alice & Bob')[0]);

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/maps/de_dust2?tab=h2h&a=Alice&b=Bob');
  });
});
