// @vitest-environment jsdom
/**
 * Component tests for `Checkbox`/`SeasonFilter` (`SeasonFilter.tsx`) — the harness prototype for
 * issue #414: click/keyboard toggling, `aria-checked` state, season-title dedup, and dropdown
 * suppression at ≤1 unique season. Run:
 *   npx vitest run src/components/SeasonFilter.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, SeasonFilter, type SeasonFilterState } from './SeasonFilter';

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
