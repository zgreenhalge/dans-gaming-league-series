// @vitest-environment jsdom
/**
 * Component tests for `EhogTimeline.tsx`'s hover tooltip: the hovered match's rating change shows
 * to two decimals with a sign only when it is non-zero, coloured from that same rounded value.
 *
 * Run:  npx vitest run src/components/EhogTimeline.test.tsx
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import EhogTimeline from './EhogTimeline';
import type { EhogRatingPoint } from '@/lib/queries';

// jsdom has no ResizeObserver; the timeline only needs it to exist.
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

const point = (matchNumber: number, ehogRating: number, ratingDelta: number): EhogRatingPoint => ({
  matchId: matchNumber,
  sequenceIndex: matchNumber,
  ehogRating,
  ratingDelta,
  seasonName: 'Season 1 Regular Season',
  seasonNumber: 1,
  isGauntlet: false,
  weekNumber: 1,
  matchNumber,
});

/** Hovers the first point (the plot's left edge, 40px in) and returns the tooltip's delta text. */
function hoveredDelta(ratingDelta: number): { text: string | null; fill: string | null } {
  const { container } = render(<EhogTimeline history={[point(1, 50, ratingDelta), point(2, 52, 2)]} />);
  fireEvent.mouseMove(container.querySelector('svg')!, { clientX: 40, clientY: 40 });
  const tspan = [...container.querySelectorAll('tspan')].find((t) => t.textContent?.startsWith('('));
  return { text: tspan?.textContent ?? null, fill: tspan?.getAttribute('fill') ?? null };
}

describe('EhogTimeline hover tooltip', () => {
  test('a gain is signed and tinted green, a loss tinted red', () => {
    expect(hoveredDelta(2.5)).toEqual({ text: '(+2.50)', fill: expect.stringMatching(/^rgb\(/) });
    const loss = hoveredDelta(-2.5);
    expect(loss.text).toBe('(-2.50)');
    expect(loss.fill).toMatch(/^rgb\(/);
  });

  test('a delta that rounds to zero has no sign and a white tint, whichever side of zero it fell', () => {
    expect(hoveredDelta(0)).toEqual({ text: '(0.00)', fill: '#ffffff' });
    expect(hoveredDelta(-0.004)).toEqual({ text: '(0.00)', fill: '#ffffff' });
    expect(hoveredDelta(0.004)).toEqual({ text: '(0.00)', fill: '#ffffff' });
  });
});
