// @vitest-environment jsdom
/**
 * Component tests for `SeasonRosterPanel`'s own Join / Leave Season button: every signed-in player
 * gets it, an admin included, and it sends that player's own id to the roster route.
 * Run: npx vitest run src/components/SeasonRosterPanel.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonRosterPanel } from './SeasonRosterPanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ADMIN_ID = 1;
const OTHER_ID = 2;
const PLAYER_ID = 3;

function renderPanel(overrides: { isAdmin?: boolean; currentPlayerId?: number | null; rosterIds?: number[] } = {}) {
  const rosterIds = overrides.rosterIds ?? [OTHER_ID];
  render(
    <SeasonRosterPanel
      seasonId={9}
      roster={rosterIds.map((id) => ({ player_id: id, player_name: `Player ${id}`, steam_avatar_url: null }))}
      allPlayers={[
        { id: ADMIN_ID, name: `Player ${ADMIN_ID}` },
        { id: OTHER_ID, name: `Player ${OTHER_ID}` },
        { id: PLAYER_ID, name: `Player ${PLAYER_ID}` },
      ]}
      isAdmin={overrides.isAdmin ?? false}
      currentPlayerId={overrides.currentPlayerId === undefined ? ADMIN_ID : overrides.currentPlayerId}
      buyInAmount={null}
    />,
  );
}

describe('SeasonRosterPanel self button', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('an admin off the roster gets Join Season, which adds themselves', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ isAdmin: true });

    await userEvent.click(screen.getByRole('button', { name: 'Join Season' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/players', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ player_id: ADMIN_ID }),
    }));
  });

  test('an admin on the roster gets Leave Season, which removes themselves', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID] });

    await userEvent.click(screen.getByRole('button', { name: 'Leave Season' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/players', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ player_id: ADMIN_ID }),
    }));
  });

  test('a player gets the same button, without the admin controls', () => {
    renderPanel({ isAdmin: false, currentPlayerId: PLAYER_ID });
    expect(screen.getByRole('button', { name: 'Join Season' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  test("while an admin's Remove on another row is in flight, the self button and every Remove are held", async () => {
    let finish: (res: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID] });

    const [, otherRemove] = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(otherRemove);

    expect(screen.getByRole('button', { name: 'Leave Season' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    finish(new Response(JSON.stringify({ ok: true })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave Season' })).toBeEnabled());
  });

  test('a viewer with no player record gets no button', () => {
    renderPanel({ isAdmin: true, currentPlayerId: null });
    expect(screen.queryByRole('button', { name: /Season$/ })).toBeNull();
  });
});
