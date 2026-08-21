// @vitest-environment jsdom
/**
 * Component tests for `SeasonTabView.tsx`'s URL state: the tab bar reads from/writes to the `tab`
 * query param via `useTabState`, and which weeks/rounds are expanded reads from/writes to a
 * comma-separated `week`/`round` param on every toggle — including a shared link opening straight to
 * one item and scrolling to it on mount. Doesn't cover the gauntlet-seeding/tab-visibility logic,
 * which has no URL-state dependency of its own.
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

describe('SeasonTabView — expand/collapse writes to the URL', () => {
  test('toggling a closed week open writes it alongside the already-open default week', async () => {
    // No override present: defaultOpenSet is the last week (id 2), since neither week has an
    // unplayed match in this fixture.
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
    await userEvent.click(screen.getByRole('button', { name: /Week 1/ }));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule&week=1%2C2');
  });

  test('collapsing the only open (default) week writes an explicit empty value, not an absent param', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /Week 2/ }));

    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule&week=');
  });

  test('toggling back to exactly the default open set omits the param entirely', async () => {
    // Override has weeks 1 and 3 open; defaultOpenSet is week 3 (the last one). Closing week 1
    // lands exactly back on the default, so the param should disappear rather than spell it out.
    nextNavigationMock.setSearchParams('tab=schedule&week=1,3');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2), week(3, 3)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Week 1/ }));

    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule');
  });

  test('"Expand all" writes every id', async () => {
    nextNavigationMock.setSearchParams('tab=schedule');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2), week(3, 3)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule&week=1%2C2%2C3');
  });

  test('"Collapse all", starting from everything open, writes the empty value', async () => {
    nextNavigationMock.setSearchParams('tab=schedule&week=1,2,3');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2), week(3, 3)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={null}
        h2hData={EMPTY_H2H}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule&week=');
  });

  test('"My games" writes `mine` and the open-items param atomically, in one navigation', async () => {
    // Regression: writing them as two separate URL updates would clobber each other, since the
    // second call's snapshot of the URL doesn't see the first call's change until the next render.
    nextNavigationMock.setSearchParams('tab=schedule');
    render(
      <SeasonTabView
        kind="regular"
        leaderboard={[leaderboardRow()]}
        schedule={[week(1, 1), week(2, 2)]}
        seasonStartDate={null}
        seasonStatus="ACTIVE"
        currentPlayerId={7}
        h2hData={EMPTY_H2H}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'My games' }));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    // No week here has any match involving player 7, so "My games" narrows the open-items set to
    // empty — distinct from `defaultOpenSet` (week 2), so it's written explicitly, not omitted.
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/seasons/1?tab=schedule&mine=1&week=');
  });

  test('a non-empty override where every id is invalid falls back to the default, not an empty set', () => {
    // Single-week schedule: defaultOpenSet is that one week (id 1). `week=999` names a week that
    // doesn't exist, which should fall back to the default rather than collapsing to "nothing open"
    // — collapsing is only what an *explicit* empty string means.
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
    expect(screen.getByRole('button', { name: /Week 1/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('an all-invalid override does not trigger the deep-link scroll, even though it falls back to the default', () => {
    // The fallback above must not be read as "a valid deep link that happens to resolve to the
    // default week" — a plain page load (no override) shouldn't scroll, and neither should a
    // stale/typo'd link that resolves the same way.
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
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
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
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

});
