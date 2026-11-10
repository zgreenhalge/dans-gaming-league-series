// @vitest-environment jsdom
/**
 * Component tests for `ScrimNightPanel`: the attendance toggle (the lists start open, the toggle folds
 * them away and back, and its label carries the signup count either way), and the admin menus (only an
 * admin has them; a row's menu sends that player's change once, and every row's actions hold while a
 * write is in flight; the header's Add player… picker signs a player up).
 *
 * Run:  npx vitest run src/components/ScrimNightPanel.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrimNightPanel } from './ScrimNightPanel';
import type { UpcomingScrimNight } from '@/lib/queries';
import { scrimSignup } from '@/lib/test-support/scrimFixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const sendJsonRequest = vi.hoisted(() => vi.fn(async () => null));
vi.mock('./sendJsonRequest', () => ({ sendJsonRequest }));

afterEach(() => sendJsonRequest.mockClear());

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

describe('ScrimNightPanel admin menus', () => {
  const players = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Cara' }];

  test('a non-admin gets no admin menus', () => {
    render(<ScrimNightPanel upcoming={upcoming} currentPlayerId={1} isAdmin={false} allPlayers={players} />);
    expect(screen.queryByRole('button', { name: /admin actions/i })).toBeNull();
  });

  test("a row's menu offers that player's actions and sends the picked one once", async () => {
    render(<ScrimNightPanel upcoming={upcoming} currentPlayerId={null} isAdmin allPlayers={players} />);
    expect(screen.queryByRole('menuitem')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Admin actions for Bob' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Check in', 'Make definite', 'Remove']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make definite' }));

    await waitFor(() => expect(sendJsonRequest).toHaveBeenCalledTimes(1));
    expect(sendJsonRequest).toHaveBeenCalledWith('POST', '/api/scrims/5/signups', { player_id: 2, commitment: 'definite' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test("every row's actions hold while a signup write is in flight", async () => {
    let finish!: () => void;
    sendJsonRequest.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(null))));
    render(<ScrimNightPanel upcoming={upcoming} currentPlayerId={null} isAdmin allPlayers={players} />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin actions for Alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    await userEvent.click(screen.getByRole('button', { name: 'Admin actions for Bob' }));
    for (const item of screen.getAllByRole('menuitem')) expect(item).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeEnabled());
    expect(sendJsonRequest).toHaveBeenCalledTimes(1);
  });

  test("the header's Add player… opens the picker and signs the picked player up", async () => {
    render(<ScrimNightPanel upcoming={upcoming} currentPlayerId={null} isAdmin allPlayers={players} />);
    await userEvent.click(screen.getByRole('button', { name: 'Attendance admin actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add player…' }));

    const select = screen.getByLabelText('Sign up a player…');
    expect(screen.getByRole('option', { name: 'Cara' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add as maybe' })).toBeDisabled();

    await userEvent.selectOptions(select, 'Cara');
    await userEvent.click(screen.getByRole('button', { name: 'Add as maybe' }));

    await waitFor(() => expect(sendJsonRequest).toHaveBeenCalledTimes(1));
    expect(sendJsonRequest).toHaveBeenCalledWith('POST', '/api/scrims/5/signups', { player_id: 3, commitment: 'maybe' });
    expect(screen.queryByLabelText('Sign up a player…')).toBeNull();
  });
});
