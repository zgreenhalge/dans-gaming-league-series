// @vitest-environment jsdom
/**
 * Component tests for `SabremetricsLeaderboardView.tsx`'s sub-tab URL state: the Aim/Weapons/
 * Economy/Flair/Opening Duels/Trades/Impact/Utility/Stats Plus tab bar reads from and writes to
 * `sub`, and the Economy tab is gated on `economyRows` the same way Stats Plus is gated on
 * `showPlusStats`.
 *
 * Run:  npx vitest run src/components/SabremetricsLeaderboardView.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { renderWithUrlState } from '@/lib/test-support/renderWithUrlState';
import { sabremetricStatRow } from '@/lib/test-support/sabFields';
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
  return {
    player_id: 1, player_name: 'Alice', match_id: 1, season_id: 1, economy_type: 'eco',
    shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
  };
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

  test('shows Economy once economyRows are wired', () => {
    nextNavigationMock.setSearchParams('sub=economy');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} economyRows={[economyRow()]} />);
    expect(screen.getByRole('tab', { name: 'Economy' })).toHaveAttribute('aria-selected', 'true');
  });

  test('shows Side Splits with no extra data wired (#482)', () => {
    nextNavigationMock.setSearchParams('sub=sides');
    renderWithUrlState(<SabremetricsLeaderboardView rows={[row()]} />);
    expect(screen.getByRole('tab', { name: 'Side Splits' })).toHaveAttribute('aria-selected', 'true');
  });
});
