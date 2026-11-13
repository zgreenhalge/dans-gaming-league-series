// @vitest-environment jsdom
/**
 * Component tests for `RefreshOnServerState`: it subscribes to the given table and filter and
 * refreshes the router once the events settle, follows a new filter, skips an unplayed row with
 * `onlyPlayed`, and with `fallback` refreshes when the tab becomes visible again and on its slow
 * interval while visible. `useRealtimeChanges` is mocked to record each call, so a test can deliver
 * a change by hand.
 *
 * Run:  npx vitest run src/components/RefreshOnServerState.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { RefreshOnServerState } from './RefreshOnServerState';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

type Subscription = {
  name: string;
  filter: { event: string; table: string; filter?: string };
  handler: (payload: { new: Record<string, unknown> }) => void;
};
const realtime = vi.hoisted(() => ({ last: null as Subscription | null }));
vi.mock('./useRealtimeChanges', () => ({
  useRealtimeChanges: (name: string, filter: Subscription['filter'], handler: Subscription['handler']) => {
    realtime.last = { name, filter, handler };
  },
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
}

function deliver(row: Record<string, unknown> = {}) {
  act(() => realtime.last!.handler({ new: row }));
}

const SETTLE_MS = 3_000;

beforeEach(() => {
  refresh.mockReset();
  realtime.last = null;
  setVisibility('visible');
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe('RefreshOnServerState', () => {
  test('subscribes to the given table, filter and event', () => {
    render(<RefreshOnServerState table="scrim_nights" filter="id=eq.3" event="UPDATE" />);
    expect(realtime.last?.filter).toEqual({ event: 'UPDATE', table: 'scrim_nights', filter: 'id=eq.3' });
  });

  test('a change refreshes the page once the events settle, once per burst', () => {
    render(<RefreshOnServerState table="matches" filter="week_id=eq.4" />);
    deliver();
    act(() => void vi.advanceTimersByTime(SETTLE_MS - 1));
    deliver();
    act(() => void vi.advanceTimersByTime(SETTLE_MS - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a new filter subscribes on a new channel', () => {
    const { rerender } = render(<RefreshOnServerState table="match_server_state" filter="match_id=eq.7" />);
    rerender(<RefreshOnServerState table="match_server_state" filter="match_id=eq.8" />);
    expect(realtime.last?.filter.filter).toBe('match_id=eq.8');
    expect(realtime.last?.name).toContain('match_id=eq.8');
  });

  test('onlyPlayed refreshes for a played score and skips an unplayed row', () => {
    render(<RefreshOnServerState table="matches" filter="id=eq.5" onlyPlayed />);
    deliver({ final_score: null });
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(refresh).not.toHaveBeenCalled();
    deliver({ final_score: '13-9' });
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('unmounting before the events settle cancels the refresh', () => {
    const { unmount } = render(<RefreshOnServerState table="matches" filter="id=eq.5" />);
    deliver();
    unmount();
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(refresh).not.toHaveBeenCalled();
  });

  test('without fallback, the tab becoming visible and time passing do not refresh', () => {
    render(<RefreshOnServerState table="matches" filter="week_id=eq.4" />);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  test('with fallback, the tab becoming visible again refreshes; going hidden does not', () => {
    render(<RefreshOnServerState table="match_server_state" filter="match_id=eq.7" fallback />);
    setVisibility('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('with fallback, a visible tab refreshes on the interval; a hidden one does not', () => {
    render(<RefreshOnServerState table="match_server_state" filter="match_id=eq.7" fallback />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('unmounting stops the fallback refreshes', () => {
    const { unmount } = render(<RefreshOnServerState table="match_server_state" filter="match_id=eq.7" fallback />);
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
