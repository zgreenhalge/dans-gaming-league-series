// @vitest-environment jsdom
/**
 * Component tests for `BasicStatsView.tsx`'s URL state: its sub-tab bar reads from/writes to the
 * `stab` query param via `useTabState`, distinct from whatever `tab` param its parent (season hub,
 * map detail, career stats page) already owns. Doesn't cover the stat-table rendering/sort logic,
 * which has no URL-state dependency of its own.
 *
 * Run:  npx vitest run src/components/BasicStatsView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { leaderboardRow } from '@/lib/test-support/leaderboardFixtures';
import { BasicStatsView } from './BasicStatsView';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/1');
});

describe('BasicStatsView — sub-tab state', () => {
  test('reads the active sub-tab from `stab`', () => {
    nextNavigationMock.setSearchParams('tab=stats&stab=games');
    render(<BasicStatsView rows={[leaderboardRow()]} />);
    expect(screen.getByRole('tab', { name: 'Game Stats' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a sub-tab pushes the URL, preserving the outer `tab` param', async () => {
    // `stab` is a tab switch too, so it pushes (creates a history entry) same as any other tab bar
    // built on `useTabState` — not a replace.
    nextNavigationMock.setSearchParams('tab=stats');
    render(<BasicStatsView rows={[leaderboardRow()]} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Game Stats' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/1?tab=stats&stab=games');
  });

  test('falls back to the first tab when `stab` names one this call site does not show', () => {
    // "Maps & Sides" only renders when `matches` is passed; without it, `stab=sides` doesn't exist.
    nextNavigationMock.setSearchParams('tab=stats&stab=sides');
    render(<BasicStatsView rows={[leaderboardRow()]} />);
    expect(screen.getByRole('tab', { name: 'Basic Stats' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Maps & Sides' })).not.toBeInTheDocument();
  });

  test('shows "Maps & Sides" and honors `stab=sides` when `matches` is passed', () => {
    nextNavigationMock.setSearchParams('tab=stats&stab=sides');
    render(<BasicStatsView rows={[leaderboardRow()]} matches={[]} />);
    expect(screen.getByRole('tab', { name: 'Maps & Sides' })).toHaveAttribute('aria-selected', 'true');
  });
});
