// @vitest-environment jsdom
/**
 * Component tests for `MatchServerPanel`'s starting state: a viewer who cannot call the status route
 * (`canManage` false) still sees the server state the page rendered with, and never a connect string;
 * and a manager's Start anyway confirmation after a forceable `server_occupied` 409.
 * Run: npx vitest run src/components/MatchServerPanel.test.tsx
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchServerPanel from './MatchServerPanel';

vi.mock('./useRealtimeChanges', () => ({ useRealtimeChanges: () => {} }));

describe('MatchServerPanel initialState', () => {
  test('a non-manager sees a provisioning server immediately', () => {
    render(<MatchServerPanel matchId={7} canManage={false} initialState="provisioning" />);
    expect(screen.getByText('Starting server…')).toBeInTheDocument();
    expect(screen.queryByText('No server running for this match.')).toBeNull();
  });

  test('a non-manager sees a live server, with no connect string', () => {
    render(<MatchServerPanel matchId={7} canManage={false} initialState="live" />);
    expect(screen.getByText('Server is live.')).toBeInTheDocument();
    expect(screen.queryByText(/connect /)).toBeNull();
  });

  test('an idle server shows the empty state', () => {
    render(<MatchServerPanel matchId={7} canManage={false} initialState="idle" />);
    expect(screen.getByText('No server running for this match.')).toBeInTheDocument();
  });
});

describe('MatchServerPanel Start anyway', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a forceable 409 turns Start server into Start anyway, which re-sends with force', async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/server/status')) return new Response(JSON.stringify({ serverState: 'idle', connectString: null }));
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? new Response(JSON.stringify({ error: '2 player(s) are on the server.', code: 'server_occupied', forceable: true }), { status: 409 })
        : new Response(JSON.stringify({ ok: true, status: 'provisioning' }), { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MatchServerPanel matchId={7} canManage initialState="idle" />);
    await userEvent.click(screen.getByRole('button', { name: 'Start server' }));
    expect(await screen.findByRole('button', { name: 'Start anyway' })).toBeInTheDocument();
    expect(screen.getByText('2 player(s) are on the server.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    await waitFor(() => expect(bodies).toEqual([{ force: false }, { force: true }]));
  });

  test('a 409 that is not forceable keeps Start server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/server/status')
        ? new Response(JSON.stringify({ serverState: 'idle', connectString: null }))
        : new Response(JSON.stringify({ error: 'Another match (#9) is currently using the server.', code: 'server_busy' }), { status: 409 }),
    ));
    render(<MatchServerPanel matchId={7} canManage initialState="idle" />);
    await userEvent.click(screen.getByRole('button', { name: 'Start server' }));
    expect(await screen.findByText('Another match (#9) is currently using the server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start server' })).toBeInTheDocument();
  });
});
