// @vitest-environment jsdom
/**
 * Component tests for `SeasonTabView.tsx`'s issue #90 URL-state migration: the tab bar reading
 * from/writing to the `tab` query param via `useTabState`, and the `week`/`round` deep-link param
 * that force-opens one schedule item on mount and scrolls it into view. Doesn't re-test the
 * gauntlet-seeding/tab-visibility logic already covered by this component reading correctly before
 * the migration — only what changed.
 *
 * Run:  npx vitest run src/components/SeasonTabView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import SeasonTabView from './SeasonTabView';
import type { WeekWithMatches, GauntletRound, H2HData } from '@/lib/queries';
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

function week(id: number, weekNumber: number): WeekWithMatches {
  return { id, season_id: 1, week_number: weekNumber, bye_player_id: null, bye_player_name: null, matches: [] };
}

function round(n: number): GauntletRound {
  return { round_number: n, matches: [] };
}

describe('SeasonTabView — tab state', () => {
  test('reads the active tab from the URL', () => {
    nextNavigationMock.setSearchParams('tab=schedule');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a tab pushes the URL (not replace)', async () => {
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));

    expect(nextNavigationMock.push).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replace).not.toHaveBeenCalled();
    expect(nextNavigationMock.push.mock.calls[0][0]).toBe('/seasons/1?tab=schedule');
  });
});

describe('SeasonTabView — week/round deep link', () => {
  test('`week=<id>` opens that week when the Schedule tab is shown', () => {
    nextNavigationMock.setSearchParams('tab=schedule&week=2');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    expect(screen.getByRole('button', { name: /Week 2/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Week 1/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('`round=<n>` opens that round in gauntlet mode', () => {
    nextNavigationMock.setSearchParams('tab=schedule&round=3');
    render(
      <SeasonTabView
        kind="gauntlet"
        rounds={[round(1), round(2), round(3)]}
        bracketShape={[]}
        leaderboard={[leaderboardRow()]}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    expect(screen.getByRole('button', { name: /Round 3/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a `week` id that does not exist in this schedule is ignored, not crashing', () => {
    nextNavigationMock.setSearchParams('tab=schedule&week=999');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    expect(screen.getByRole('button', { name: /Week 1/ })).toBeInTheDocument();
  });
});
