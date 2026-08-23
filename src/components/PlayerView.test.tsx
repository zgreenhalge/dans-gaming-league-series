// @vitest-environment jsdom
/**
 * Component tests for `PlayerView.tsx`'s URL state: the tab bar reads from/writes to `tab`, the
 * matches sub-tab reads from/writes to `msub` (falling back to "history" when there's nothing
 * upcoming under the current filter, without rewriting the URL), and the season filter — via the
 * now URL-backed `useSeasonFilter()` — reads from/writes to `reg`/`gnt`/`season`. Toggling
 * regular/gauntlet writes only its own key; a `season` selection that's no longer valid under the
 * new include-flags self-corrects to "Career" at read time (`useSeasonFilter`'s
 * `regularSeasons`/`gauntletSeasons` clamp), with no write-back to the URL.
 *
 * Run:  npx vitest run src/components/PlayerView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { renderWithUrlState } from '@/lib/test-support/renderWithUrlState';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import PlayerView from './PlayerView';
import type { PlayerHistoryRow } from '@/lib/queries';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/players/1');
});

function historyRow(overrides: Partial<PlayerHistoryRow> = {}): PlayerHistoryRow {
  return {
    id: 1,
    match_id: 1,
    player_id: 1,
    faction: 'SHIRTS',
    kills: 10,
    assists: 2,
    deaths: 5,
    adr: 80,
    damage: 1000,
    rounds_played: 13,
    rounds_won: 8,
    is_win: true,
    match_number: 1,
    week_number: 1,
    season_id: 1,
    season_number: 1,
    season_name: 'Season 1',
    is_gauntlet: false,
    map: 'de_dust2',
    final_score: '13-9',
    scheduled_at: null,
    shirts: [{ player_id: 1, player_name: 'Alice' }],
    skins: [{ player_id: 2, player_name: 'Bob' }],
    shirts_stats: [],
    skins_stats: [],
    picked_map: null,
    shirts_pick: null,
    skins_starting_side: null,
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    is_playoff_game: false,
    map_pool: null,
    replay_status: null,
    ...overrides,
  };
}

function baseProps(overrides: { history?: PlayerHistoryRow[] } = {}) {
  return {
    playerId: 1,
    history: overrides.history ?? [historyRow()],
    trophies: [],
    careerLeaderboard: [],
    players: [],
    ehogHistory: [],
    matchDeltas: {},
  };
}

describe('PlayerView — tab state', () => {
  test('reads the active tab from the URL', () => {
    nextNavigationMock.setSearchParams('tab=matches');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: /Matches/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab pushes the URL', async () => {
    renderWithUrlState(<PlayerView {...baseProps()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Matches/ }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/players/1?tab=matches');
  });

  test('falls back to the first tab when `tab` names one this player does not have', () => {
    // No trophies and no ready-replay match in this fixture, so "trophies"/"trails" don't exist.
    nextNavigationMock.setSearchParams('tab=trophies');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('PlayerView — matches sub-tab', () => {
  test('reads `msub=upcoming` when there is an upcoming match', () => {
    nextNavigationMock.setSearchParams('tab=matches&msub=upcoming');
    renderWithUrlState(
      <PlayerView
        {...baseProps({
          history: [historyRow({ id: 2, final_score: null, scheduled_at: '2030-01-01T00:00:00Z' })],
        })}
      />,
    );
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('falls back to "history" when `msub=upcoming` but nothing is upcoming, without rewriting the URL', () => {
    nextNavigationMock.setSearchParams('tab=matches&msub=upcoming');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    // No upcoming-match sub-tab bar renders at all when there's nothing upcoming.
    expect(screen.queryByRole('tab', { name: /Upcoming/ })).not.toBeInTheDocument();
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
  });
});

describe('PlayerView — season filter', () => {
  test('reads a specific `season` id', () => {
    nextNavigationMock.setSearchParams('season=1');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    expect(screen.getByText('Season stats')).toBeInTheDocument();
  });

  test('defaults to career when `season` is absent', () => {
    renderWithUrlState(<PlayerView {...baseProps()} />);
    expect(screen.getByText('Career stats')).toBeInTheDocument();
  });

  test('toggling regular/gauntlet writes only `reg`/`gnt`, in one navigation, leaving `season` in the URL', async () => {
    // The Checkbox component's role="checkbox" span has no accessible name of its own (a
    // pre-existing gap, not introduced here) — its label text is a separate sibling with its own
    // onClick, so click that directly instead of querying by role.
    nextNavigationMock.setSearchParams('tab=stats&season=1');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    await userEvent.click(screen.getByText('Regular Season'));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    // `season=1` is left in place — a stale value there self-corrects at read time on the next
    // render (via `useSeasonFilter`'s `regularSeasons` clamp) instead of being written back out.
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/players/1?tab=stats&season=1&reg=0');
  });

  test('a `season` id no longer valid under the current include-flags falls back to "Career" without rewriting the URL', () => {
    // `season=1` names a regular season, but `reg=0` excludes regular seasons — the selection
    // should read as "Career" on this very render, not just after a follow-up navigation.
    nextNavigationMock.setSearchParams('reg=0&season=1');
    renderWithUrlState(<PlayerView {...baseProps()} />);
    expect(screen.getByText('Career stats')).toBeInTheDocument();
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
  });
});
