// @vitest-environment jsdom
/**
 * Component tests for `SeasonTabView.tsx`'s URL state: the tab bar reads from/writes to the `tab`
 * query param via `useTabState`, and a `week`/`round` deep-link param force-opens one schedule item
 * on mount and scrolls it into view. Doesn't cover the gauntlet-seeding/tab-visibility logic, which
 * has no URL-state dependency of its own.
 *
 * Run:  npx vitest run src/components/SeasonTabView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow, EMPTY_H2H } from '@/lib/test-support/leaderboardFixtures';
import SeasonTabView from './SeasonTabView';
import type { WeekWithMatches, GauntletRound } from '@/lib/queries';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/1');
});

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

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule');
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
