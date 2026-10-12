// @vitest-environment jsdom
/**
 * Component tests for the sortable scorecards (`StageScorecard.tsx`): the canonical ranking is the
 * default order, a header click re-sorts, names and seeds sort A-first / smallest-first, and nulls
 * stay last. Run: npx vitest run src/components/StageScorecard.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupScorecard, WeekScorecard } from './StageScorecard';
import type { GroupRow, WeekScorecardRow } from '@/lib/stage-views';
import { emptyRecord } from '@/lib/group-scorecard';

function weekRow(over: Partial<WeekScorecardRow> & { player_id: number; player_name: string; rank: number }): WeekScorecardRow {
  return { ...emptyRecord(over.player_id, over.player_name), matches_played: 1, movement: null, ...over };
}

const week: WeekScorecardRow[] = [
  weekRow({ player_id: 1, player_name: 'Carol', rank: 1, wins: 2, losses: 0, adr: 90, rwr_percentage: 60, movement: { before: 3, after: 1 } }),
  weekRow({ player_id: 2, player_name: 'Alice', rank: 2, wins: 1, losses: 1, adr: 70, rwr_percentage: 55, movement: { before: 1, after: 2 } }),
  weekRow({ player_id: 3, player_name: 'Bob', rank: 3, wins: 0, losses: 2, adr: 80, rwr_percentage: 40, movement: { before: 2, after: 3 } }),
];

/** The Player column's names, top to bottom. */
function names(): string[] {
  return screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
}

describe('WeekScorecard sorting', () => {
  test('starts in canonical rank order', () => {
    render(<WeekScorecard rows={week} showMovement currentPlayerId={null} />);
    expect(names()).toEqual(['Carol', 'Alice', 'Bob']);
    expect(screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-sort'))).toEqual(Array(6).fill('none'));
  });

  test('a stat column sorts descending first, then flips', async () => {
    render(<WeekScorecard rows={week} showMovement currentPlayerId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /ADR/ }));
    expect(names()).toEqual(['Carol', 'Bob', 'Alice']);
    await userEvent.click(screen.getByRole('button', { name: /ADR/ }));
    expect(names()).toEqual(['Alice', 'Bob', 'Carol']);
  });

  test('Player sorts A-first, then flips', async () => {
    render(<WeekScorecard rows={week} showMovement currentPlayerId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /Player/ }));
    expect(names()).toEqual(['Alice', 'Bob', 'Carol']);
    await userEvent.click(screen.getByRole('button', { name: /Player/ }));
    expect(names()).toEqual(['Carol', 'Bob', 'Alice']);
  });

  test('week 1 has no Season column', () => {
    render(<WeekScorecard rows={week} showMovement={false} currentPlayerId={null} />);
    expect(screen.queryByRole('button', { name: /Season/ })).toBeNull();
  });

  test('K/D sorts by kills per death', async () => {
    const rows = week.map((r, i) => ({ ...r, kd_ratio: [1.1, 2.5, 0.8][i] }));
    render(<WeekScorecard rows={rows} showMovement currentPlayerId={null} />);
    await userEvent.click(screen.getByRole('button', { name: /K\/D/ }));
    expect(names()).toEqual(['Alice', 'Carol', 'Bob']);
  });
});

describe('GroupScorecard sorting', () => {
  const group: GroupRow[] = [
    { ...emptyRecord(1, 'Dee'), matches_played: 2, wins: 2, losses: 0, adr: 85, rwr_percentage: 61, rank: 1, seed: 4, outcome: 'advances' },
    { ...emptyRecord(2, 'Eve'), matches_played: 2, wins: 1, losses: 1, adr: 75, rwr_percentage: 50, rank: 2, seed: 2, outcome: 'eliminated' },
    { ...emptyRecord(3, 'Fay'), matches_played: 0, rank: null, seed: 1, outcome: 'pending' },
  ];

  test('Seed sorts smallest-first; unplayed rows (no ADR) stay last whichever way ADR runs', async () => {
    render(<GroupScorecard rows={group} isFinal={false} finished={false} currentPlayerId={null} />);
    const cell = (i: number) => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[i].textContent ?? '');
    await userEvent.click(screen.getByRole('button', { name: /Seed/ }));
    expect(cell(1)).toEqual(['Fay', 'Eve', 'Dee']);
    await userEvent.click(screen.getByRole('button', { name: /ADR/ }));
    expect(cell(1)).toEqual(['Dee', 'Eve', 'Fay']);
    await userEvent.click(screen.getByRole('button', { name: /ADR/ }));
    expect(cell(1)).toEqual(['Eve', 'Dee', 'Fay']);
  });
});
