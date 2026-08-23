// @vitest-environment jsdom
/**
 * Component tests for `Checkbox`/`SeasonFilter` (`SeasonFilter.tsx`) — click/keyboard toggling,
 * `aria-checked` state, season-title dedup, and dropdown suppression at ≤1 unique season — plus unit
 * tests for `useSeasonFilter()`'s URL state: `reg`/`gnt`/`season` reads and writes, the
 * "don't allow turning off the last remaining filter" guard, and the `regularSeasons`/
 * `gauntletSeasons` validity clamp (a pure derive-at-read fallback to `'all'`, the same shape as
 * `resolveTab()` in `useTabState.ts`).
 *
 * Run:  npx vitest run src/components/SeasonFilter.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { Checkbox, SeasonFilter, useSeasonFilter, type SeasonFilterState } from './SeasonFilter';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/players/1');
});

function baseFilter(overrides: Partial<SeasonFilterState> = {}): Pick<
  SeasonFilterState,
  'includeRegular' | 'includeGauntlet' | 'toggleRegular' | 'toggleGauntlet' | 'selectedSeason'
> {
  return {
    includeRegular: true,
    includeGauntlet: true,
    selectedSeason: 'all',
    toggleRegular: () => {},
    toggleGauntlet: () => {},
    ...overrides,
  };
}

describe('Checkbox', () => {
  test('reflects checked state via aria-checked', () => {
    const { rerender } = render(<Checkbox checked={false} onToggle={() => {}} label="Regular Season" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    rerender(<Checkbox checked={true} onToggle={() => {}} label="Regular Season" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  test('calls onToggle on click', async () => {
    let toggled = false;
    render(<Checkbox checked={false} onToggle={() => { toggled = true; }} label="Regular Season" />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(toggled).toBe(true);
  });

  test('calls onToggle on Space and Enter, not on other keys', () => {
    let count = 0;
    render(<Checkbox checked={false} onToggle={() => { count++; }} label="Regular Season" />);
    const box = screen.getByRole('checkbox');
    fireEvent.keyDown(box, { key: ' ' });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'a' });
    expect(count).toBe(2);
  });
});

describe('SeasonFilter', () => {
  test('deduplicates a regular+gauntlet pair sharing the same season title into one entry', () => {
    const seasons = [
      { id: 1, name: 'Season 3', is_gauntlet: false },
      { id: 2, name: 'Season 3 Gauntlet', is_gauntlet: true },
      { id: 3, name: 'Season 4', is_gauntlet: false },
    ];
    render(
      <SeasonFilter filter={baseFilter()} seasons={seasons} onSeasonChange={() => {}} />,
    );
    const select = screen.getByRole('combobox');
    // "All seasons" + Season 3 (deduped) + Season 4 = 3 options, not 4.
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  test('suppresses the dropdown entirely when there is only one (or zero) unique seasons', () => {
    const seasons = [{ id: 1, name: 'Season 3', is_gauntlet: false }];
    render(
      <SeasonFilter filter={baseFilter()} seasons={seasons} onSeasonChange={() => {}} />,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('useSeasonFilter', () => {
  test('defaults to both filters on and "all" seasons when no params are set', () => {
    const { result } = renderHook(() => useSeasonFilter());
    expect(result.current.includeRegular).toBe(true);
    expect(result.current.includeGauntlet).toBe(true);
    expect(result.current.selectedSeason).toBe('all');
  });

  test('reads `reg=0`/`gnt=0`/`season=<id>` from the URL', () => {
    nextNavigationMock.setSearchParams('reg=0&gnt=0&season=5');
    const { result } = renderHook(() => useSeasonFilter());
    expect(result.current.includeRegular).toBe(false);
    expect(result.current.includeGauntlet).toBe(false);
    expect(result.current.selectedSeason).toBe(5);
  });

  test('toggleRegular writes `reg=0` and replaces (not pushes)', () => {
    const { result } = renderHook(() => useSeasonFilter());
    act(() => result.current.toggleRegular());

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/players/1?reg=0');
  });

  test('toggleRegular refuses to turn off the last remaining filter', () => {
    nextNavigationMock.setSearchParams('gnt=0');
    const { result } = renderHook(() => useSeasonFilter());
    act(() => result.current.toggleRegular());

    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
  });

  test('setSelectedSeason writes `season`', () => {
    const { result } = renderHook(() => useSeasonFilter());
    act(() => result.current.setSelectedSeason(7));

    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/players/1?season=7');
  });

  test('toggling always writes a single key, leaving `season` untouched in the URL', () => {
    nextNavigationMock.setSearchParams('season=5');
    const { result } = renderHook(() => useSeasonFilter({ regularSeasons: [{ id: 5 }], gauntletSeasons: [] }));
    act(() => result.current.toggleRegular());

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState.mock.calls[0][2]).toBe('/players/1?season=5&reg=0');
  });

  test('without `regularSeasons`/`gauntletSeasons`, `selectedSeason` reads the raw URL value uncorrected', () => {
    nextNavigationMock.setSearchParams('reg=0&season=5');
    const { result } = renderHook(() => useSeasonFilter());
    expect(result.current.selectedSeason).toBe(5);
  });

  test('an options object with neither list set also reads the raw URL value uncorrected', () => {
    // Distinct from omitting `options` entirely — passing `{}` must not force-clamp to 'all' just
    // because an options object exists.
    nextNavigationMock.setSearchParams('reg=0&season=5');
    const { result } = renderHook(() => useSeasonFilter({}));
    expect(result.current.selectedSeason).toBe(5);
  });

  test('clamps `selectedSeason` to \'all\' when the raw id names no season in the valid lists', () => {
    nextNavigationMock.setSearchParams('season=99');
    const { result } = renderHook(() =>
      useSeasonFilter({ regularSeasons: [{ id: 1 }, { id: 2 }], gauntletSeasons: [{ id: 3 }] }),
    );
    expect(result.current.selectedSeason).toBe('all');
  });

  test('keeps `selectedSeason` when the raw id is in the valid regular or gauntlet list', () => {
    nextNavigationMock.setSearchParams('season=3');
    const { result } = renderHook(() =>
      useSeasonFilter({ regularSeasons: [{ id: 1 }, { id: 2 }], gauntletSeasons: [{ id: 3 }] }),
    );
    expect(result.current.selectedSeason).toBe(3);
  });

  test('clamps a regular-season selection to \'all\' once `reg=0` excludes its list', () => {
    nextNavigationMock.setSearchParams('reg=0&season=1');
    const { result } = renderHook(() =>
      useSeasonFilter({ regularSeasons: [{ id: 1 }], gauntletSeasons: [{ id: 2 }] }),
    );
    expect(result.current.selectedSeason).toBe('all');
  });

  test('a selection from the still-included list survives the other flag being off', () => {
    nextNavigationMock.setSearchParams('gnt=0&season=1');
    const { result } = renderHook(() =>
      useSeasonFilter({ regularSeasons: [{ id: 1 }], gauntletSeasons: [{ id: 2 }] }),
    );
    expect(result.current.selectedSeason).toBe(1);
  });
});
