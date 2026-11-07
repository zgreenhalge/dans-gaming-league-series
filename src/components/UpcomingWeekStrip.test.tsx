// @vitest-environment jsdom
/**
 * Component tests for `UpcomingWeekStrip.tsx`: seven days from today, a diamond per league game,
 * a scrim night's seats with the day marked full once four are definite, and each day's label
 * carrying what it holds.
 *
 * Run:  npx vitest run src/components/UpcomingWeekStrip.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpcomingWeekStrip } from './UpcomingWeekStrip';
import type { UpcomingScrimNight } from '@/lib/queries';
import { scrimSignup } from '@/lib/test-support/scrimFixtures';

/** Noon local time, `days` from today — clear of the day's edges whatever the time now. */
function noon(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12).toISOString();
}

function scrim(id: number, startsAt: string, definite: number, maybe: number): UpcomingScrimNight {
  return {
    night: { id, startsAt },
    started: false,
    checkInOpen: false,
    signups: [
      ...Array.from({ length: definite }, (_, i) => scrimSignup(i + 1, 'definite')),
      ...Array.from({ length: maybe }, (_, i) => scrimSignup(100 + i, 'maybe')),
    ],
  };
}

describe('UpcomingWeekStrip', () => {
  test('seven days from today; league games and scrim nights each show on their day', () => {
    render(<UpcomingWeekStrip gameTimes={[noon(0), noon(0), noon(3)]} scrims={[scrim(1, noon(1), 4, 1), scrim(2, noon(2), 2, 2)]} />);
    const days = screen.getAllByRole('img');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName(/2 league games/);
    expect(days[1]).toHaveAccessibleName(/scrim night: 4 definite, 1 maybe, full/);
    expect(days[2]).toHaveAccessibleName(/scrim night: 2 definite, 2 maybe$/);
    expect(days[3]).toHaveAccessibleName(/1 league game$/);
    expect(days[4].getAttribute('aria-label')).not.toMatch(/league|scrim/);
  });

  test('a game or night past the week ahead is left off the strip', () => {
    render(<UpcomingWeekStrip gameTimes={[noon(9)]} scrims={[scrim(1, noon(8), 4, 0)]} />);
    for (const day of screen.getAllByRole('img')) expect(day.getAttribute('aria-label')).not.toMatch(/league|scrim/);
  });

  test('a league game takes precedence: its day leads with the game and the scrim night does not colour it', () => {
    render(<UpcomingWeekStrip gameTimes={[noon(1)]} scrims={[scrim(1, noon(1), 4, 0)]} />);
    const day = screen.getAllByRole('img')[1];
    expect(day).toHaveAccessibleName(/1 league game · scrim night: 4 definite, 0 maybe, full/);
    expect(day.className).not.toMatch(/green/);
  });
});
