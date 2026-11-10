// @vitest-environment jsdom
/**
 * Component tests for `ScrimNightMatchList`, a scrim night's running order: each row's status, and the
 * admin's Confirm result / Discard menu on a Pending row that `resolve`s — Discard only after a confirm.
 *
 * `next/navigation` is mocked for `useRefreshingAction()` and Confirm result's navigation.
 *
 * Run:  npx vitest run src/components/ScrimNightResults.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrimNightMatchList } from './ScrimNightResults';
import type { ScrimMatch } from '@/lib/queries';
import type { ScrimRunningOrderEntry } from '@/lib/scrim-night-page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

const names = { 1: 'Alice', 2: 'Bob', 3: 'Cara', 4: 'Dee' };

function scrimMatch(id: number, final_score: string | null, server_state: string | null): ScrimMatch {
  return {
    id,
    night_id: 5,
    match_number: id,
    map: 'cobble',
    workshop_id: null,
    side_choice: 'knife',
    skins_starting_side: null,
    shirts: [1, 2],
    skins: [3, 4],
    players: [],
    final_score,
    server_state,
  };
}

function renderList(entries: ScrimRunningOrderEntry[]) {
  return render(<ScrimNightMatchList entries={entries} names={names} currentPlayerId={null} />);
}

describe('ScrimNightMatchList', () => {
  test('rows read their status: score, Pending, Live, Up next', () => {
    renderList([
      { match: scrimMatch(1, '13-9', 'done'), status: 'played', resolve: false },
      { match: scrimMatch(2, null, 'done'), status: 'pending', resolve: false },
      { match: scrimMatch(3, null, 'live'), status: 'live', resolve: false },
      { match: scrimMatch(4, null, null), status: 'next', resolve: false },
    ]);
    expect(screen.getByText('13-9')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Up next')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Admin actions/ })).toBeNull();
  });

  test("a resolving Pending row's menu opens the match page to confirm, and discards after a confirm", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    renderList([{ match: scrimMatch(2, null, 'done'), status: 'pending', resolve: true }]);
    const menu = screen.getByRole('button', { name: 'Admin actions for match 2' });

    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Confirm result…' }));
    expect(push).toHaveBeenCalledWith('/scrims/matches/2');

    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Discard…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/scrims/matches/2', expect.objectContaining({ method: 'DELETE' })));
    vi.unstubAllGlobals();
  });
});
