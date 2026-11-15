// @vitest-environment jsdom
/**
 * Component tests for `SeasonManager`'s season-scoped ops errors: a failed read shows one inline error
 * while the seasons still render; a loaded one lists them.
 * Run: npx vitest run src/components/SeasonManager.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeasonManager, type SeasonSummary } from './SeasonManager';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const seasons: SeasonSummary[] = [{ id: 5, name: 'Season 5', status: 'UPCOMING', isGauntlet: false, gauntletStatus: null }];

describe('SeasonManager', () => {
  test('a failed season ops-errors read shows an inline error and still renders the seasons', () => {
    render(
      <SeasonManager
        allSeasons={seasons}
        gauntletsInProgress={[]}
        seasonOpsErrors={{ ok: false, error: 'ops_errors unreadable', label: 'season ops errors' }}
        nextSeasonName="Season 6"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load season ops errors");
    expect(screen.getByText('ops_errors unreadable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Season 5' })).toBeInTheDocument();
  });

  test('a loaded read shows no error', () => {
    render(
      <SeasonManager allSeasons={seasons} gauntletsInProgress={[]} seasonOpsErrors={{ ok: true, data: [] }} nextSeasonName="Season 6" />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Season 5' })).toBeInTheDocument();
  });
});
