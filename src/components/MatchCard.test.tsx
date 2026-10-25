// @vitest-environment jsdom
/**
 * Component tests for `MatchCard.tsx`'s EHOG delta column: each player's rating change shows to one
 * decimal with a sign only when it is non-zero, coloured green, red or neutral from that same
 * rounded value.
 *
 * Run:  npx vitest run src/components/MatchCard.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchCard, type MatchCardPlayer } from './MatchCard';

const player = (id: number, name: string): MatchCardPlayer => ({ player_id: id, player_name: name, kills: 10, assists: 2, deaths: 8, adr: 80 });

function renderCard(ehogDeltas: Record<number, number> | null) {
  return render(
    <MatchCard
      href="/matches/1"
      label={{ type: 'match', matchNumber: 1, isFeatureMatch: false }}
      right={{ type: 'score', score: '13-9' }}
      shirtsStats={[player(1, 'Alice'), player(2, 'Bob')]}
      skinsStats={[player(3, 'Cara'), player(4, 'Dee')]}
      ehogDeltas={ehogDeltas}
    />,
  );
}

describe('MatchCard EHOG delta column', () => {
  test('a gain is signed and green, a loss is red', () => {
    renderCard({ 1: 1.25, 2: -1.25, 3: 0, 4: 0 });
    expect(screen.getByText('+1.3')).toHaveStyle({ color: 'var(--color-accent-green-fg)' });
    expect(screen.getByText('-1.3')).toHaveStyle({ color: 'var(--color-accent-red-fg)' });
  });

  test('a delta that rounds to zero has no sign and a neutral colour, whichever side of zero it fell', () => {
    renderCard({ 1: 0, 2: -0.04, 3: 0.04, 4: 2 });
    const zeros = screen.getAllByText('0.0');
    expect(zeros).toHaveLength(3);
    for (const zero of zeros) expect(zero).toHaveStyle({ color: 'var(--color-text-secondary)' });
    expect(screen.queryByText('-0.0')).toBeNull();
    expect(screen.queryByText('+0.0')).toBeNull();
  });

  test('shows no column without deltas', () => {
    renderCard(null);
    expect(screen.queryByText('0.0')).toBeNull();
  });
});
