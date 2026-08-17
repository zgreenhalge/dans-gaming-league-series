// @vitest-environment jsdom
/**
 * Component tests for `VetoSequence.tsx` — the map-veto state machine: tile-click routing
 * (actionable slot vs. an overwritable filled slot vs. inert), the optimistic-update path (applied
 * immediately on submit, before the PATCH round-trips), and the two submission shapes (a map pick
 * vs. a side pick), plus the admin per-field clear and clear-all actions.
 *
 * `next/navigation`'s `useRouter()` and `@/lib/supabase-browser`'s `getBrowserClient()` (the
 * postgres_changes subscription in a `useEffect`) are mocked — neither is exercised by these tests,
 * which only cover the click/submit state machine. `next/link` is never rendered here: every test
 * uses `canVeto: true`, and `VetoSequence` only renders a `Link` when `canVeto` is false.
 *
 * Run:  npx vitest run src/components/VetoSequence.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import VetoSequence from './VetoSequence';
import type { Match } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/supabase-browser', () => {
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
  return { getBrowserClient: () => client };
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

function baseMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 1,
    week_id: 1,
    match_number: 1,
    final_score: null,
    picked_map: null,
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    shirts_pick: null,
    skins_starting_side: null,
    is_playoff_game: false,
    is_feature_match: false,
    pre_match_win_prob: null,
    pre_match_win_prob_formula_version: null,
    scheduled_at: null,
    round_history: null,
    recording_url: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<ComponentProps<typeof VetoSequence>> = {}): ComponentProps<typeof VetoSequence> {
  return {
    match: baseMatch(),
    mapPool: ['Foroglio', 'Vertigo', 'Cobblestone'],
    canVeto: true,
    isGauntlet: false,
    playerFaction: 'SHIRTS',
    gauntletPlayerIndex: null,
    isAdmin: false,
    ...overrides,
  };
}

function patchedFields(): string[] {
  return fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).field);
}

describe('VetoSequence: tile-click routing', () => {
  test('only the actionable slot (this player\'s next turn) is interactive', () => {
    render(<VetoSequence {...baseProps()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Shirts ban');
  });

  test('clicking the actionable tile opens the picker; clicking it again closes it', async () => {
    const user = userEvent.setup();
    render(<VetoSequence {...baseProps()} />);
    const tile = screen.getByRole('button', { name: /Shirts ban/i });
    await user.click(tile);
    expect(screen.getByRole('button', { name: /Foroglio/i })).toBeInTheDocument();
    await user.click(tile);
    expect(screen.queryByRole('button', { name: /Foroglio/i })).toBeNull();
  });

  test('a slot that is neither the actionable one nor overwritable by this player stays inert', async () => {
    const user = userEvent.setup();
    // SHIRTS's turn (shirts_ban); skins_ban1 belongs to the other faction and has no value yet.
    render(<VetoSequence {...baseProps()} />);
    const banTiles = screen.getAllByText('Skins ban');
    // Clicking the (non-interactive) label text must not open a picker.
    await user.click(banTiles[0]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Foroglio/i })).toBeNull();
  });
});

describe('VetoSequence: map-pick submission + optimistic update', () => {
  test('picking a map submits a PATCH and applies the value optimistically before it resolves', async () => {
    const user = userEvent.setup();
    render(<VetoSequence {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Shirts ban/i }));
    await user.click(screen.getByRole('button', { name: /Foroglio/i }));

    await waitFor(() => expect(screen.getByText('Foroglio')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/matches/1/veto',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ field: 'shirts_ban', value: 'Foroglio' }),
      }),
    );
    // Submitting closes the picker.
    expect(screen.queryByRole('button', { name: /Vertigo/i })).toBeNull();
  });

  test('a map already used elsewhere in the veto is disabled in the picker', async () => {
    const user = userEvent.setup();
    const match = baseMatch({ shirts_ban: 'Vertigo' }); // makes skins_ban1 the actionable slot
    render(<VetoSequence {...baseProps({ match, playerFaction: 'SKINS' })} />);
    await user.click(screen.getByRole('button', { name: /Skins ban/i }));
    expect(screen.getByRole('button', { name: /Vertigo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Foroglio/i })).toBeEnabled();
  });

  test('a failed PATCH reverts the optimistic value', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Not your turn' }) });
    render(<VetoSequence {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /Shirts ban/i }));
    await user.click(screen.getByRole('button', { name: /Foroglio/i }));

    // Reverted once the PATCH resolves: the tile stops showing the optimistic value.
    await waitFor(() => expect(screen.queryByText('Foroglio')).toBeNull());
  });
});

describe('VetoSequence: side-pick submission path', () => {
  test('the side step opens CT/T buttons, not the map picker, and submits the chosen side', async () => {
    const user = userEvent.setup();
    const match = baseMatch({
      shirts_ban: 'Vertigo',
      skins_ban1: 'Cobblestone',
      skins_ban2: 'Foroglio',
      shirts_pick: 'Vertigo',
    });
    render(<VetoSequence {...baseProps({ match, playerFaction: 'SKINS' })} />);
    await user.click(screen.getByRole('button', { name: /Skins start/i }));

    const ctButton = screen.getByRole('button', { name: 'CT' });
    expect(ctButton).toBeInTheDocument();
    // No map tiles for a side step — map buttons carry a `title` attribute, side buttons don't.
    expect(screen.queryByTitle('Foroglio')).toBeNull();

    await user.click(ctButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/matches/1/veto',
        expect.objectContaining({ body: JSON.stringify({ field: 'skins_starting_side', value: 'CT' }) }),
      ),
    );
  });
});

describe('VetoSequence: admin clear actions', () => {
  test('the per-field clear button stops propagation (does not also open the picker) and submits null', async () => {
    const user = userEvent.setup();
    const match = baseMatch({ shirts_ban: 'Foroglio' });
    render(<VetoSequence {...baseProps({ match, isAdmin: true, playerFaction: null })} />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/matches/1/veto',
        expect.objectContaining({ body: JSON.stringify({ field: 'shirts_ban', value: null }) }),
      ),
    );
    expect(screen.queryByRole('button', { name: /Vertigo/i })).toBeNull();
  });

  test('clear-all fires one PATCH per filled slot, nulling each', async () => {
    const user = userEvent.setup();
    const match = baseMatch({ shirts_ban: 'Foroglio', skins_ban1: 'Vertigo', skins_ban2: 'Cobblestone' });
    render(<VetoSequence {...baseProps({ match, isAdmin: true, playerFaction: null })} />);
    await user.click(screen.getByRole('button', { name: 'Clear all pick/bans' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(new Set(patchedFields())).toEqual(new Set(['shirts_ban', 'skins_ban1', 'skins_ban2']));
  });

  test('clear-all is absent when nothing is set yet', () => {
    render(<VetoSequence {...baseProps({ isAdmin: true, playerFaction: null })} />);
    expect(screen.queryByRole('button', { name: 'Clear all pick/bans' })).toBeNull();
  });
});
