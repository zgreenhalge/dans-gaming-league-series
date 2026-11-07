// @vitest-environment jsdom
/**
 * Hook tests for `useRealtimeChanges`: it opens one `postgres_changes` channel on the given table and
 * filter, calls the latest `onChange` for each event, rebuilds the channel when the filter changes,
 * removes it on unmount, and opens nothing while disabled or without a browser client. `@/lib/supabase-browser`'s
 * `getBrowserClient()` is mocked with a client whose channels record their handler.
 *
 * Run:  npx vitest run src/components/useRealtimeChanges.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRealtimeChanges, type RealtimeChange } from './useRealtimeChanges';

interface FakeChannel {
  name: string;
  filter: Record<string, unknown>;
  handler: (payload: RealtimeChange) => void;
}

const { channels, client, env } = vi.hoisted(() => {
  const channels: FakeChannel[] = [];
  const client = {
    channel: (name: string) => {
      const ch = { name } as FakeChannel;
      const api = {
        on: (_type: string, filter: FakeChannel['filter'], handler: FakeChannel['handler']) => {
          Object.assign(ch, { filter, handler });
          return api;
        },
        subscribe: () => {
          channels.push(ch);
          return ch;
        },
      };
      return api;
    },
    removeChannel: vi.fn(),
  };
  // `configured: false` stands for an unset browser Supabase env, where `getBrowserClient()` is null.
  return { channels, client, env: { configured: true } };
});
vi.mock('@/lib/supabase-browser', () => ({ getBrowserClient: () => (env.configured ? client : null) }));

const change = { eventType: 'UPDATE', new: { match_id: 7 }, old: {} } as unknown as RealtimeChange;

beforeEach(() => {
  channels.length = 0;
  client.removeChannel.mockReset();
  env.configured = true;
});

type Args = { filter: string; onChange: (p: RealtimeChange) => void; enabled?: boolean };
const useSubject = ({ filter, onChange, enabled }: Args) =>
  useRealtimeChanges(`chan-${filter}`, { event: '*', table: 'match_server_state', filter }, onChange, enabled);

describe('useRealtimeChanges', () => {
  test('subscribes on the table and filter, and calls the latest onChange for each event', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(useSubject, { initialProps: { filter: 'match_id=eq.7', onChange: first } });
    expect(channels).toHaveLength(1);
    expect(channels[0].filter).toEqual({ event: '*', schema: 'public', table: 'match_server_state', filter: 'match_id=eq.7' });

    rerender({ filter: 'match_id=eq.7', onChange: latest });
    expect(channels).toHaveLength(1);
    channels[0].handler(change);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(change);
  });

  test('a new filter removes the old channel and opens one on the new filter', () => {
    const { rerender } = renderHook(useSubject, { initialProps: { filter: 'match_id=eq.7', onChange: vi.fn() } });
    rerender({ filter: 'match_id=eq.8', onChange: vi.fn() });
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(channels).toHaveLength(2);
    expect(channels[1].filter.filter).toBe('match_id=eq.8');
  });

  test('unmounting removes the channel', () => {
    const { unmount } = renderHook(useSubject, { initialProps: { filter: 'match_id=eq.7', onChange: vi.fn() } });
    unmount();
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
  });

  test('opens nothing while disabled', () => {
    renderHook(useSubject, { initialProps: { filter: 'match_id=eq.7', onChange: vi.fn(), enabled: false } });
    expect(channels).toHaveLength(0);
  });

  test('does nothing without a browser client', () => {
    env.configured = false;
    const { unmount } = renderHook(useSubject, { initialProps: { filter: 'match_id=eq.7', onChange: vi.fn() } });
    unmount();
    expect(channels).toHaveLength(0);
    expect(client.removeChannel).not.toHaveBeenCalled();
  });
});
