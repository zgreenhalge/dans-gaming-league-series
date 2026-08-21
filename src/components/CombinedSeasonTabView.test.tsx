// @vitest-environment jsdom
/**
 * Component tests for `CombinedSeasonTabView.tsx`'s issue #90 URL-state migration: `topTab` reads
 * from/writes to the `view` param, `subTab` reads from/writes to the `tab` param, and both stay
 * shared between the regular-season and gauntlet `SeasonTabView` instances it renders.
 *
 * Run:  npx vitest run src/components/CombinedSeasonTabView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import CombinedSeasonTabView from './CombinedSeasonTabView';
import type { H2HData } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/1');
});

const EMPTY_H2H: H2HData = { duos: [], rivals: [], players: [] };

function leaderboardRow(overrides: Partial<LeaderboardRowWithId> = {}): LeaderboardRowWithId {
  return {
    season_id: 1,
    player_id: 1,
    player_name: 'Alice',
    matches_played: 1,
    matches_won: 1,
    matches_lost: 0,
    win_rate_percentage: 100,
    total_kills: 10,
    total_assists: 2,
    total_deaths: 5,
    kd_ratio: 2,
    total_damage: 500,
    total_rounds_played: 13,
    total_rounds_won: 8,
    rwr_percentage: 61.5,
    overall_adr: 38.46,
    kills_in_wins: 10,
    deaths_in_wins: 5,
    kills_in_losses: 0,
    deaths_in_losses: 0,
    ...overrides,
  };
}

function baseProps() {
  return {
    leaderboard: [leaderboardRow()],
    schedule: [],
    seasonStartDate: null,
    seasonStatus: 'ACTIVE',
    gauntletRounds: [],
    gauntletBracketShape: [],
    gauntletLeaderboard: [leaderboardRow({ player_id: 2, player_name: 'Bob' })],
    gauntletStatus: 'ACTIVE',
    currentPlayerId: null,
    h2hData: EMPTY_H2H,
    gauntletH2hData: EMPTY_H2H,
  };
}

describe('CombinedSeasonTabView — top tab (`view`) and sub tab (`tab`)', () => {
  test('reads the active top tab from `view`', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    render(<CombinedSeasonTabView {...baseProps()} />);
    expect(screen.getByRole('tab', { name: 'Gauntlet' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking the top tab pushes `view`, not `tab`', async () => {
    render(<CombinedSeasonTabView {...baseProps()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Gauntlet' }));

    expect(nextNavigationMock.push).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.push.mock.calls[0][0]).toBe('/seasons/1?view=gauntlet');
  });

  test('switching `view` preserves an existing `tab` param instead of dropping it', async () => {
    nextNavigationMock.setSearchParams('tab=stats');
    render(<CombinedSeasonTabView {...baseProps()} />);
    expect(screen.getAllByRole('tab', { name: 'Stats' })[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Gauntlet' }));
    expect(nextNavigationMock.push.mock.calls[0][0]).toBe('/seasons/1?tab=stats&view=gauntlet');
  });
});
