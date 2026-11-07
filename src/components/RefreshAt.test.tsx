// @vitest-environment jsdom
/**
 * Component tests for `RefreshAt`: it refreshes the router half a second after the given time
 * (straight away for a time already past), and never for a time too far out for `setTimeout`.
 *
 * Run:  npx vitest run src/components/RefreshAt.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RefreshAt } from './RefreshAt';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const NOW = Date.parse('2026-01-01T20:00:00Z');

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('RefreshAt', () => {
  test('refreshes once the time arrives, not before', () => {
    render(<RefreshAt iso={new Date(NOW + 60_000).toISOString()} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time already past refreshes straight away', () => {
    render(<RefreshAt iso={new Date(NOW - 60_000).toISOString()} />);
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time too far out for setTimeout never refreshes', () => {
    render(<RefreshAt iso={new Date(NOW + 2 ** 31).toISOString()} />);
    vi.advanceTimersByTime(2 ** 31 - 1);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('unmounting cancels the refresh', () => {
    const { unmount } = render(<RefreshAt iso={new Date(NOW + 1_000).toISOString()} />);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
