// @vitest-environment jsdom
/**
 * Component tests for `RefreshOnServerState`: it subscribes to its match's `match_server_state`
 * changes and refreshes the router on each, follows a new `matchId`, and refreshes when the tab
 * becomes visible again and on its slow fallback interval while visible. `useRealtimeChanges` is
 * mocked to record each call, so a test can deliver a change by hand.
 *
 * Run:  npx vitest run src/components/RefreshOnServerState.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { RefreshOnServerState } from './RefreshOnServerState';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

type Subscription = { name: string; filter: { table: string; filter?: string }; handler: () => void };
const realtime = vi.hoisted(() => ({ last: null as Subscription | null }));
vi.mock('./useRealtimeChanges', () => ({
  useRealtimeChanges: (name: string, filter: Subscription['filter'], handler: Subscription['handler']) => {
    realtime.last = { name, filter, handler };
  },
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  refresh.mockReset();
  realtime.last = null;
  setVisibility('visible');
  vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe('RefreshOnServerState', () => {
  test('a server state change for its match refreshes the page', () => {
    render(<RefreshOnServerState matchId={7} />);
    expect(realtime.last?.filter).toMatchObject({ table: 'match_server_state', filter: 'match_id=eq.7' });
    expect(refresh).not.toHaveBeenCalled();
    act(() => realtime.last!.handler());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a new matchId subscribes to the new match', () => {
    const { rerender } = render(<RefreshOnServerState matchId={7} />);
    rerender(<RefreshOnServerState matchId={8} />);
    expect(realtime.last?.filter.filter).toBe('match_id=eq.8');
    expect(realtime.last?.name).toContain('8');
  });

  test('the tab becoming visible again refreshes; going hidden does not', () => {
    render(<RefreshOnServerState matchId={7} />);
    setVisibility('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a visible tab refreshes on the fallback interval; a hidden one does not', () => {
    render(<RefreshOnServerState matchId={7} />);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('unmounting stops the visibility and interval refreshes', () => {
    const { unmount } = render(<RefreshOnServerState matchId={7} />);
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
