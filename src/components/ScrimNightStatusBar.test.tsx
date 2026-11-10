// @vitest-environment jsdom
/**
 * Component tests for `ScrimNightStatusBar`: it renders what `buildScrimNightPageModel()`'s `status`
 * gives it — the state pill, the checked-in count and the league-match marks, with no buttons for a
 * signed-out viewer — and the viewer's own Check in and commitment send their writes.
 *
 * Run:  npx vitest run src/components/ScrimNightStatusBar.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrimNightStatusBar } from './ScrimNightStatusBar';
import type { ScrimNightStatus } from '@/lib/scrim-night-page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const sendJsonRequest = vi.hoisted(() => vi.fn(async () => null));
vi.mock('./sendJsonRequest', () => ({ sendJsonRequest }));

afterEach(() => sendJsonRequest.mockClear());

const LIVE: ScrimNightStatus = { state: 'live', checkedInCount: 3, leagueMatches: [], checkIn: null, commitment: null };

function renderBar(status: Partial<ScrimNightStatus>) {
  return render(<ScrimNightStatusBar nightId={5} startsAt="2026-01-01T20:00:00Z" status={{ ...LIVE, ...status }} />);
}

describe('ScrimNightStatusBar', () => {
  test('signed out: the state, the count and the league marks, with no buttons', () => {
    renderBar({ leagueMatches: [{ id: 42, label: 'Season 4 · Wk 3 · Match 2', scheduledAt: '2026-01-01T21:00:00Z' }] });
    expect(screen.getByText('Happening now')).toBeInTheDocument();
    expect(screen.getByText('3 checked in')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/matches/42');
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a final night shows Final and no count', () => {
    renderBar({ state: 'final', checkedInCount: null });
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByText(/checked in/)).toBeNull();
  });

  test("the viewer's Check in and commitment send their own writes", async () => {
    renderBar({ checkIn: { playerId: 7, checkedIn: false }, commitment: { playerId: 7, commitment: 'maybe' } });
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(sendJsonRequest).toHaveBeenCalledWith('POST', '/api/scrims/5/check-in', { player_id: 7 }));

    await userEvent.click(screen.getByRole('button', { name: 'Definite' }));
    await waitFor(() => expect(sendJsonRequest).toHaveBeenCalledWith('POST', '/api/scrims/5/signups', { player_id: 7, commitment: 'definite' }));
  });
});
