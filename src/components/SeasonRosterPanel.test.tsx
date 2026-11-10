// @vitest-environment jsdom
/**
 * Component tests for `SeasonRosterPanel`: the Join / Leave Season button every signed-in player gets,
 * an admin included, which sends that player's own id to the roster route; and the admin menus (only an
 * admin has them, never on their own row; a row's Remove sends that player's id; the header's Add
 * player… picker adds a player and leaves out the admin and everyone already on the roster; every
 * control holds while a roster write is in flight; a failed write shows its error).
 * Run: npx vitest run src/components/SeasonRosterPanel.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

function stubFetch(status = 200, body: unknown = { ok: true }) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function expectRosterWrite(fetchMock: ReturnType<typeof vi.fn>, method: 'POST' | 'DELETE', playerId: number) {
  expect(fetchMock).toHaveBeenCalledWith('/api/seasons/9/players', expect.objectContaining({
    method,
    body: JSON.stringify({ player_id: playerId }),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SeasonRosterPanel self button', () => {
  test('an admin off the roster gets Join Season, which adds themselves', async () => {
    const fetchMock = stubFetch(201);
    renderPanel({ isAdmin: true });

    await userEvent.click(screen.getByRole('button', { name: 'Join Season' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRosterWrite(fetchMock, 'POST', ADMIN_ID);
  });

  test('an admin on the roster gets Leave Season, which removes themselves', async () => {
    const fetchMock = stubFetch();
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID] });

    await userEvent.click(screen.getByRole('button', { name: 'Leave Season' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRosterWrite(fetchMock, 'DELETE', ADMIN_ID);
  });

  test('a player gets the same button, without any admin menu or gauntlet warning', () => {
    renderPanel({ isAdmin: false, currentPlayerId: PLAYER_ID });
    expect(screen.getByRole('button', { name: 'Join Season' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /admin actions/i })).toBeNull();
    expect(screen.queryByText(/automated gauntlet/)).toBeNull();
  });

  test('a viewer with no player record gets no button', () => {
    renderPanel({ isAdmin: true, currentPlayerId: null });
    expect(screen.queryByRole('button', { name: /Season$/ })).toBeNull();
  });

  test("a failed write shows the route's error", async () => {
    stubFetch(409, { error: 'Roster is locked.' });
    renderPanel({ isAdmin: false, currentPlayerId: PLAYER_ID });

    await userEvent.click(screen.getByRole('button', { name: 'Join Season' }));

    expect(await screen.findByText('Roster is locked.')).toBeInTheDocument();
  });
});

describe('SeasonRosterPanel admin menus', () => {
  test("an admin gets a menu on every other player's row but not their own, and the gauntlet warning", () => {
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID] });
    expect(screen.getByRole('button', { name: `Admin actions for Player ${OTHER_ID}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Admin actions for Player ${ADMIN_ID}` })).toBeNull();
    expect(screen.getByText(/automated gauntlet/)).toBeInTheDocument();
  });

  test("a row's Remove sends that player's removal once", async () => {
    const fetchMock = stubFetch();
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID] });

    await userEvent.click(screen.getByRole('button', { name: `Admin actions for Player ${OTHER_ID}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRosterWrite(fetchMock, 'DELETE', OTHER_ID);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Add player… lists only players off the roster other than the admin, and adds the pick', async () => {
    const fetchMock = stubFetch(201);
    renderPanel({ isAdmin: true, rosterIds: [OTHER_ID] });

    await userEvent.click(screen.getByRole('button', { name: 'Roster admin actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add player…' }));
    const picker = screen.getByRole('combobox', { name: 'Add a player…' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Add a player…', `Player ${PLAYER_ID}`]);

    await userEvent.selectOptions(picker, String(PLAYER_ID));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRosterWrite(fetchMock, 'POST', PLAYER_ID);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('while a Remove is in flight, the self button and every row action are held', async () => {
    let finish: (res: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    renderPanel({ isAdmin: true, rosterIds: [ADMIN_ID, OTHER_ID, PLAYER_ID] });

    await userEvent.click(screen.getByRole('button', { name: `Admin actions for Player ${OTHER_ID}` }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(screen.getByRole('button', { name: 'Leave Season' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: `Admin actions for Player ${PLAYER_ID}` }));
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeDisabled();

    finish(new Response(JSON.stringify({ ok: true })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave Season' })).toBeEnabled());
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeEnabled();
  });
});
