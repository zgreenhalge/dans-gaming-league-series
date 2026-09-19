// @vitest-environment jsdom
/**
 * Component tests for `CombinedSeasonTabView.tsx`: `topTab` reads from/writes to the `view` param,
 * `subTab` reads from/writes to the `tab` param and stays shared between the regular-season and
 * gauntlet `SeasonTabView` instances it renders, and the non-initial tab's light data is fetched
 * lazily (mocked here) the first time it's opened.
 *
 * Run:  npx vitest run src/components/CombinedSeasonTabView.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { renderWithUrlState } from '@/lib/test-support/renderWithUrlState';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow, EMPTY_H2H } from '@/lib/test-support/leaderboardFixtures';
import type { RegularSeasonLightView, GauntletSeasonLightView, SeasonStatsView } from '@/lib/queries';
import CombinedSeasonTabView from './CombinedSeasonTabView';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

// A season auto-activates on schedule confirm (before any match is played), so `seasonStatus: 'ACTIVE'`
// alone no longer implies real standings exist — SeasonTabView's Leaderboard/Stats tabs also need at
// least one played match. This fixture stands in for that.
const PLAYED_WEEK = {
  id: 1,
  season_id: 1,
  week_number: 1,
  bye_player_id: null,
  bye_player_name: null,
  matches: [
    {
      id: 100,
      week_id: 1,
      match_number: 1,
      final_score: '13-8',
      picked_map: null,
      shirts_ban: null,
      shirts_ban2: null,
      skins_ban1: null,
      skins_ban2: null,
      shirts_pick: null,
      skins_starting_side: null,
      is_playoff_game: false,
      is_feature_match: false,
      pre_match_win_prob: null,
      pre_match_win_prob_formula_version: null,
      scheduled_at: null,
      round_history: null,
      recording_url: null,
      shirts: [],
      skins: [],
      shirts_stats: [],
      skins_stats: [],
    },
  ],
};

const REGULAR_LIGHT: RegularSeasonLightView = {
  schedule: [PLAYED_WEEK],
  h2hData: EMPTY_H2H,
  ehogRatings: {},
  hasAdvancedStats: false,
};

const GAUNTLET_LIGHT: GauntletSeasonLightView = {
  rounds: [],
  leaderboard: [leaderboardRow({ player_id: 2, player_name: 'Bob' })],
  h2hData: EMPTY_H2H,
  ehogRatings: {},
  hasAdvancedStats: false,
};

const EMPTY_STATS: SeasonStatsView = {
  sabremetrics: [],
  matchRounds: [],
  matchKills: [],
  matchWeaponClassStats: [],
  matchEconomyStats: [],
};

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/1');
  // Backs whichever tab's light data isn't already seeded via `initialLightData`, and any Stats/
  // Advanced Stats sub-tab fetch — a test that clicks into either exercises its own lazy-fetch path
  // against this mock instead of a real network call. Keyed by URL rather than a single blanket
  // response so `/view` (light) and `/stats` calls each get their own correctly-shaped payload.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.includes('/stats') ? EMPTY_STATS : GAUNTLET_LIGHT),
      } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseProps() {
  return {
    leaderboard: [leaderboardRow()],
    seasonStartDate: null,
    seasonStatus: 'ACTIVE',
    gauntletBracketShape: [],
    gauntletStatus: 'ACTIVE',
    gauntletStarted: false,
    currentPlayerId: null,
    isAdmin: false,
    regularSeasonId: 1,
    gauntletSeasonId: 2,
    seasonNumber: 1,
    initialView: 'regular' as const,
    initialLightData: { kind: 'regular' as const, data: REGULAR_LIGHT },
  };
}

/** Props for a test that starts on the Gauntlet tab (`view=gauntlet`) — seeds gauntlet data too, so
 *  the initial render doesn't need the lazy-fetch mock to resolve first. */
function gauntletInitialProps() {
  return {
    ...baseProps(),
    initialView: 'gauntlet' as const,
    initialLightData: { kind: 'gauntlet' as const, data: GAUNTLET_LIGHT },
  };
}

describe('CombinedSeasonTabView — top tab (`view`) and sub tab (`tab`)', () => {
  test('reads the active top tab from `view`', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    renderWithUrlState(<CombinedSeasonTabView {...gauntletInitialProps()} />);
    expect(screen.getByRole('tab', { name: 'Gauntlet' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking the top tab pushes `view`, not `tab`', async () => {
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Gauntlet' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?view=gauntlet');
  });

  test('switching `view` preserves an existing `tab` param instead of dropping it', async () => {
    nextNavigationMock.setSearchParams('tab=stats');
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);
    expect(screen.getAllByRole('tab', { name: 'Stats' })[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Gauntlet' }));
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?tab=stats&view=gauntlet');
  });
});

describe('CombinedSeasonTabView — lazy-loading the non-initial tab', () => {
  // `nextNavigationMock`'s `pushState` is a no-op spy that never feeds back into `useSearchParams()`
  // (see its own doc comment) — a simulated tab click can't actually change which tab the component
  // reads as active, so these exercise the lazy-fetch path via the URL the component mounts with
  // instead: `view=gauntlet` makes `topTab` read as `'gauntlet'` on the very first render even
  // though only the regular view's heavy data was eagerly seeded, the same mismatch a real
  // navigation to `?view=gauntlet` produces the instant before its own fetch resolves.
  test('fetches and renders a tab whose data was not eagerly seeded', async () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);

    // The fetch mock resolves GAUNTLET_HEAVY's leaderboard — its player ("Bob") should appear once
    // loading finishes.
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('never fetches when the active tab already has data', () => {
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('CombinedSeasonTabView — Stats/Advanced Stats sub-tab data', () => {
  // The stats-view cache lives here (not inside SeasonTabView, which unmounts on every top-tab
  // switch) precisely so it survives switching top tabs away and back — see this component's own
  // `statsCache` doc comment. `nextNavigationMock.pushState` doesn't feed back into
  // `useSearchParams()` (see the lazy-loading describe block above), so a real switch-away-and-back
  // can't be exercised via simulated clicks here; this instead verifies the wiring a real switch
  // would exercise — that opening the Stats sub-tab fetches the right season/kind's stats data.
  test('fetches the active top tab\'s stats data once the Stats sub-tab is open', async () => {
    nextNavigationMock.setSearchParams('tab=stats');
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);

    await screen.findByRole('tab', { name: 'Stats' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe(
      '/api/seasons/1/stats?kind=regular',
    );
  });

  test('does not fetch stats data while on the Leaderboard sub-tab', () => {
    renderWithUrlState(<CombinedSeasonTabView {...baseProps()} />);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('CombinedSeasonTabView — admin "Manage Bracket" link on the Gauntlet tab', () => {
  test('shown for an admin before any game in the gauntlet has been played', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    renderWithUrlState(<CombinedSeasonTabView {...gauntletInitialProps()} isAdmin regularSeasonId={7} />);
    expect(screen.getByRole('link', { name: 'Manage Bracket →' })).toHaveAttribute(
      'href',
      '/admin/seasons/gauntlet/manual/7',
    );
  });

  test('hidden for a non-admin', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    renderWithUrlState(<CombinedSeasonTabView {...gauntletInitialProps()} isAdmin={false} regularSeasonId={7} />);
    expect(screen.queryByRole('link', { name: 'Manage Bracket →' })).not.toBeInTheDocument();
  });

  test('hidden once any game in the gauntlet has been played, even for an admin', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    renderWithUrlState(
      <CombinedSeasonTabView {...gauntletInitialProps()} isAdmin regularSeasonId={7} gauntletStarted />,
    );
    expect(screen.queryByRole('link', { name: 'Manage Bracket →' })).not.toBeInTheDocument();
  });
});
