// @vitest-environment jsdom
/**
 * Component tests for `MatchTabView.tsx`'s EHOG rating projection table: each projected delta shows
 * to two decimals with a sign only when it is non-zero, tinted from that same rounded value.
 *
 * Run:  npx vitest run src/components/MatchTabView.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingProjectionTable } from './MatchTabView';
import type { RatingProjection } from '@/lib/ehog';

const shirts = [{ player_id: 1, player_name: 'Alice' }];
const skins = [{ player_id: 2, player_name: 'Bob' }];

function renderTable(projections: RatingProjection[]) {
  return render(<RatingProjectionTable projections={projections} shirts={shirts} skins={skins} />);
}

describe('RatingProjectionTable', () => {
  test('a gain is signed and tinted green, a loss tinted red', () => {
    renderTable([{ label: '13-9', scoreA: 13, scoreB: 9, deltas: { 1: 2.5, 2: -2.5 } }]);
    expect(screen.getByText('+2.50').getAttribute('style')).toContain('--color-accent-green-fill');
    expect(screen.getByText('-2.50').getAttribute('style')).toContain('--color-accent-red-fg');
  });

  test('a delta that rounds to zero has no sign and no tint, whichever side of zero it fell', () => {
    renderTable([
      { label: '13-9', scoreA: 13, scoreB: 9, deltas: { 1: 2.5, 2: -0.004 } },
      { label: '9-13', scoreA: 9, scoreB: 13, deltas: { 1: 0.004, 2: 0 } },
    ]);
    const zeros = screen.getAllByText('0.00');
    expect(zeros).toHaveLength(3);
    for (const zero of zeros) expect(zero.getAttribute('style')).not.toMatch(/accent-(green|red)/);
    expect(screen.queryByText('-0.00')).toBeNull();
    expect(screen.queryByText('+0.00')).toBeNull();
  });
});
