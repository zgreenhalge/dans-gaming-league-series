// @vitest-environment jsdom
/**
 * Component tests for `ScrimLobbyPanel`'s lobby match: its card (`LobbyMatchCard`) reads Pending
 * before the server starts and Live once it has, for an admin and a non-admin alike. An admin can
 * configure the match only before it starts, and discard it — after a confirm — whenever it isn't
 * holding the server.
 *
 * `MatchServerPanel` is stubbed — it has its own tests — and `next/navigation` is mocked for
 * `useRefreshingAction()`.
 *
 * Run:  npx vitest run src/components/ScrimLobbyPanel.test.tsx
 */

import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { ScrimLobbyPanel } from './ScrimLobbyPanel';
import type { ScrimMatch } from '@/lib/queries';
import { scrimMatchHref } from '@/lib/crumbs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./MatchServerPanel', () => ({ default: () => <div>server panel</div> }));

const names = { 1: 'Alice', 2: 'Bob', 3: 'Cara', 4: 'Dee' };

function scrimMatch(server_state: string | null): ScrimMatch {
  return {
    id: 42,
    night_id: 5,
    match_number: 3,
    map: 'cobble',
    workshop_id: null,
    side_choice: 'random',
    skins_starting_side: null,
    shirts: [1, 2],
    skins: [3, 4],
    players: [],
    final_score: null,
    server_state,
  };
}

function renderLobby(match: ScrimMatch, canManage: boolean) {
  const props: ComponentProps<typeof ScrimLobbyPanel> = {
    nightId: 5,
    match,
    queued: [],
    pool: Object.entries(names).map(([id, name]) => ({ id: Number(id), name })),
    names,
    maps: [],
    canMake: canManage,
    canManage,
    currentPlayerId: canManage ? null : 1,
    viewer: null,
    rounds: null,
    leagueMatches: [],
  };
  return render(<ScrimLobbyPanel {...props} />);
}

describe('ScrimLobbyPanel lobby match card', () => {
  for (const [who, canManage] of [['an admin', true], ['a non-admin', false]] as const) {
    test(`${who} sees the card as Pending before the server starts`, () => {
      renderLobby(scrimMatch(null), canManage);
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.queryByText('Live')).toBeNull();
    });

    test(`${who} sees the card as Live while the server runs`, () => {
      renderLobby(scrimMatch('live'), canManage);
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.queryByText('Pending')).toBeNull();
    });
  }

  test('the card links to the scrim match page', () => {
    renderLobby(scrimMatch(null), false);
    expect(screen.getByText('Pending').closest('a')).toHaveAttribute('href', scrimMatchHref(42));
  });
});

describe('ScrimLobbyPanel admin config', () => {
  test('an admin can configure the match before the server starts', () => {
    renderLobby(scrimMatch(null), true);
    expect(screen.getByText(/Configure · Match 3/)).toBeInTheDocument();
  });

  test('while the server is running there is no config to change and nothing to discard, for anyone', () => {
    for (const canManage of [true, false]) {
      const { unmount } = renderLobby(scrimMatch('live'), canManage);
      expect(screen.queryByText(/Configure/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
      unmount();
    }
  });

  test('a match whose server stopped without a score can be discarded, not configured', () => {
    renderLobby(scrimMatch('done'), true);
    expect(screen.queryByText(/Configure/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  test('Discard asks for a confirm before it deletes anything', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    renderLobby(scrimMatch('done'), true);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/scrims/matches/42', expect.objectContaining({ method: 'DELETE' })));
    vi.unstubAllGlobals();
  });

  test('a non-admin never sees the config', () => {
    renderLobby(scrimMatch(null), false);
    expect(screen.queryByText(/Configure/)).toBeNull();
  });
});
