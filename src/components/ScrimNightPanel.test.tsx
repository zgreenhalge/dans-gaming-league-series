// @vitest-environment jsdom
/**
 * Component tests for `ScrimNightPanel`'s attendance toggle: the lists start open, the toggle folds
 * them away and back, and its label carries the signup count either way.
 *
 * Run:  npx vitest run src/components/ScrimNightPanel.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrimNightPanel } from './ScrimNightPanel';
import type { UpcomingScrimNight } from '@/lib/queries';
import { scrimSignup } from '@/lib/test-support/scrimFixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const upcoming: UpcomingScrimNight = {
  night: { id: 5, startsAt: '2026-01-01T20:00:00Z' },
  started: true,
  checkInOpen: true,
  signups: [scrimSignup(1, 'definite', { player_name: 'Alice' }), scrimSignup(2, 'maybe', { player_name: 'Bob' })],
};

describe('ScrimNightPanel attendance toggle', () => {
  test('starts open, folds the lists away, and opens them again', async () => {
    render(<ScrimNightPanel upcoming={upcoming} currentPlayerId={null} isAdmin={false} allPlayers={[]} />);
    const toggle = screen.getByRole('button', { name: /Attendance · 2/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Attendance · 2');
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('Bob')).toBeNull();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});
