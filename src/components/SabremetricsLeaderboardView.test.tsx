// @vitest-environment jsdom
/**
 * Component tests for `SabremetricsLeaderboardView.tsx`'s sub-tab URL state: the Aim/Weapons/
 * Economy/Flair/Opening Duels/Trades/Impact/Utility/Stats Plus tab bar reads from and writes to
 * `sub`, and the Economy tab is gated on the separate `hasEconomyData` prop (not on `economyRows`
 * itself, which can be season-filtered to empty) the same way Stats Plus is gated on
 * `showPlusStats`.
 *
 * Run:  npx vitest run src/components/SabremetricsLeaderboardView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { renderWithUrlState } from '@/lib/test-support/renderWithUrlState';
import { sabremetricStatRow, economyMatchRow } from '@/lib/test-support/sabFields';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/players/1');
});

function row() {
  return sabremetricStatRow({ player_id: 1, match_id: 1 });
}

function economyRow() {
  return economyMatchRow({ player_id: 1, match_id: 1, economy_type: 'eco' });
}

describe('SabremetricsLeaderboardView — sub-tab URL state', () => {
  test('defaults to Aim when the URL names no sub-tab', () => {
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    expect(screen.getByRole('tab', { name: 'Aim' })).toHaveAttribute('aria-selected', 'true');
  });

  test('reads the active sub-tab from the `sub` URL param', () => {
    nextNavigationMock.setSearchParams('sub=utility');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    expect(screen.getByRole('tab', { name: 'Utility' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a sub-tab pushes `sub` onto the URL', async () => {
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Trades' }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/players/1?sub=trades');
  });

  test('falls back to the first visible sub-tab when `sub` names one hidden by `showPlusStats=false`', () => {
    nextNavigationMock.setSearchParams('sub=plus');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} showPlusStats={false} />);
    expect(screen.queryByRole('tab', { name: 'Stats Plus' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aim' })).toHaveAttribute('aria-selected', 'true');
  });

  test('hides Economy when no economyRows are wired (#481)', () => {
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    expect(screen.queryByRole('tab', { name: 'Economy' })).not.toBeInTheDocument();
  });

  test('hides Economy when economyRows are wired but hasEconomyData is left at its default', () => {
    // hasEconomyData defaults to false rather than economyRows.length > 0, on purpose: deriving it
    // from a prop that can be season-filtered would silently reintroduce the bug this prop exists
    // to prevent for any caller that forgets to pass it explicitly.
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} economyRows={[economyRow()]} />);
    expect(screen.queryByRole('tab', { name: 'Economy' })).not.toBeInTheDocument();
  });

  test('shows Economy once economyRows are wired', () => {
    nextNavigationMock.setSearchParams('sub=economy');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} economyRows={[economyRow()]} hasEconomyData />);
    expect(screen.getByRole('tab', { name: 'Economy' })).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps Economy visible when hasEconomyData=true even though the current season filter left economyRows empty', () => {
    // Regression for a bug where gating on economyRows.length directly (a season-filtered prop)
    // silently booted the viewer off the Economy tab the moment they filtered to a season with no
    // parsed economy data — docs/patterns.md requires the gate signal to be unscoped by transient
    // filters like this one, which is exactly what the separate `hasEconomyData` prop is for.
    nextNavigationMock.setSearchParams('sub=economy');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} economyRows={[]} hasEconomyData />);
    expect(screen.getByRole('tab', { name: 'Economy' })).toHaveAttribute('aria-selected', 'true');
  });

  test('has no Side Splits tab (#482, removed — see #506)', () => {
    nextNavigationMock.setSearchParams('sub=sides');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    expect(screen.queryByRole('tab', { name: 'Side Splits' })).not.toBeInTheDocument();
    // A `sub` naming a tab that no longer exists falls back to the first visible tab, same as
    // `sub=plus` does when Stats Plus is hidden.
    expect(screen.getByRole('tab', { name: 'Aim' })).toHaveAttribute('aria-selected', 'true');
  });
});
