// @vitest-environment jsdom
/**
 * Component tests for `RefreshOnServerState`: a `match_server_state` change for its match refreshes
 * the router, the subscription is filtered to that match, and a new `matchId` swaps the channel for
 * one on the new match. `@/lib/supabase-browser`'s `getBrowserClient()` is mocked with a channel that
 * records its handler, so a test can deliver a change by hand.
 *
 * Run:  npx vitest run src/components/RefreshOnServerState.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { RefreshOnServerState } from './RefreshOnServerState';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

interface FakeChannel {
  name: string;
  filter: { table: string; filter?: string };
  handler: (payload: unknown) => void;
}

const { channels, client } = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const client = {
    channel: vi.fn((name: string) => {
      const ch = { name } as FakeChannel;
      const api = {
        on: (_type: string, filter: FakeChannel['filter'], handler: FakeChannel['handler']) => {
          ch.filter = filter;
          ch.handler = handler;
          return api;
        },
        subscribe: () => {
          channels.push(ch);
          return ch;
        },
      };
      return api;
    }),
    removeChannel: vi.fn(),
  };
  return { channels, client };
});
vi.mock('@/lib/supabase-browser', () => ({ getBrowserClient: () => client }));

beforeEach(() => {
  refresh.mockReset();
  client.removeChannel.mockReset();
  channels.length = 0;
});

describe('RefreshOnServerState', () => {
  test('a server state change for its match refreshes the page', () => {
    render(<RefreshOnServerState matchId={7} />);
    expect(channels).toHaveLength(1);
    expect(channels[0].filter).toMatchObject({ table: 'match_server_state', filter: 'match_id=eq.7' });
    expect(refresh).not.toHaveBeenCalled();
    act(() => channels[0].handler({ eventType: 'UPDATE', new: { match_id: 7, server_state: 'live' } }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a new matchId re-subscribes on the new match and drops the old channel', () => {
    const { rerender } = render(<RefreshOnServerState matchId={7} />);
    rerender(<RefreshOnServerState matchId={8} />);
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(channels).toHaveLength(2);
    expect(channels[1].name).toBe('match-server-refresh-8');
    expect(channels[1].filter.filter).toBe('match_id=eq.8');
  });

  test('unmounting removes the channel', () => {
    const { unmount } = render(<RefreshOnServerState matchId={7} />);
    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
  });
});
