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
import { createNextAuthMock } from '@/lib/test-support/mockNextAuth';
import { leaderboardRow, EMPTY_H2H } from '@/lib/test-support/leaderboardFixtures';
import CombinedSeasonTabView from './CombinedSeasonTabView';

vi.mock('next/navigation', () => createNextNavigationMock());
vi.mock('next-auth/react', () => createNextAuthMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/1');
});

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

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?view=gauntlet');
  });

  test('switching `view` preserves an existing `tab` param instead of dropping it', async () => {
    nextNavigationMock.setSearchParams('tab=stats');
    render(<CombinedSeasonTabView {...baseProps()} />);
    expect(screen.getAllByRole('tab', { name: 'Stats' })[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Gauntlet' }));
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?tab=stats&view=gauntlet');
  });
});
