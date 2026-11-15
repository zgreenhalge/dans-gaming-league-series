// @vitest-environment jsdom
/**
 * Component tests for `ServerConsolePanel`'s isolated reads: a failed picker read leaves the occupant
 * view in place with an inline error where the pickers would be, and a failed occupant read is shown
 * as an error, never as an idle server.
 * Run: npx vitest run src/components/ServerConsolePanel.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServerConsolePanel } from './ServerConsolePanel';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const occupant: ActiveServerMatch = {
  matchId: 7,
  label: 'Season 5 · Wk 2 · Match 3',
  serverState: 'live',
  connectString: '1.2.3.4:27015',
  serverStartedAt: null,
};

const pickersOk = { ok: true as const, data: { configSets: [{ key: 'golden', label: 'Golden' }], maps: [] } };

describe('ServerConsolePanel', () => {
  // The status poll never settles, so the server-rendered reads are what renders.
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))));
  afterEach(() => vi.unstubAllGlobals());

  test('a failed picker read keeps the occupant and its controls, with an inline error for the pickers', () => {
    render(
      <ServerConsolePanel
        active={{ ok: true, data: occupant }}
        pickers={{ ok: false, error: 'config_sets unreadable', label: 'the config-set and map pickers' }}
      />,
    );
    expect(screen.getByText('Season 5 · Wk 2 · Match 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tear down' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the config-set and map pickers");
    expect(screen.queryByRole('button', { name: 'Apply config set' })).toBeNull();
  });

  test('a failed occupant read shows an error instead of an idle server, and the pickers still render', () => {
    render(
      <ServerConsolePanel
        active={{ ok: false, error: 'match_server_state unreadable', label: 'the server status' }}
        pickers={pickersOk}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the server status");
    expect(screen.queryByRole('button', { name: 'Tear down' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply config set' })).toBeInTheDocument();
  });

  test('pickers that load after a failed first render default to the first config set', () => {
    const { rerender } = render(
      <ServerConsolePanel active={{ ok: true, data: null }} pickers={{ ok: false, error: 'boom', label: 'the config-set and map pickers' }} />,
    );
    rerender(<ServerConsolePanel active={{ ok: true, data: null }} pickers={pickersOk} />);
    expect(screen.getByRole('combobox', { name: /config set/i })).toHaveValue('golden');
  });
});
