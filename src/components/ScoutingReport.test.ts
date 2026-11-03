/**
 * Unit tests for `heatTitle()` in `ScoutingReport.tsx`: the tooltip for a map stat's gap to the
 * player's career average.
 *
 * Run:  npx vitest run src/components/ScoutingReport.test.ts
 */

import { describe, expect, test } from 'vitest';
import { heatTitle } from './ScoutingReport';

describe('heatTitle', () => {
  test('reports the gap above or below the career average', () => {
    expect(heatTitle(85.26, 80, ' ADR', 1)).toBe('+5.3 ADR above career average');
    expect(heatTitle(48, 52.5, '%', 1)).toBe('4.5% below career average');
  });

  test('a gap that rounds to zero at the shown precision reads as at the average', () => {
    expect(heatTitle(80.04, 80, ' ADR', 1)).toBe('At career average');
    expect(heatTitle(79.96, 80, ' ADR', 1)).toBe('At career average');
    expect(heatTitle(80, 80, ' ADR', 1)).toBe('At career average');
  });
});
