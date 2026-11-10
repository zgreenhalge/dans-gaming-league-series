// @vitest-environment jsdom
/**
 * Component tests for `RefreshAt`: it refreshes the router shortly after the given time (straight
 * away for a time already past), never for a time too far out for `setTimeout`, and only once per time.
 *
 * Run:  npx vitest run src/components/RefreshAt.test.tsx
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RefreshAt } from './RefreshAt';

const refresh = vi.fn();
// The app router hands every `useRouter()` the same instance, so the mock does too.
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

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
    vi.advanceTimersByTime(60_000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time already past refreshes straight away', () => {
    render(<RefreshAt iso={new Date(NOW - 60_000).toISOString()} />);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time too far out for setTimeout never refreshes', () => {
    render(<RefreshAt iso={new Date(NOW + 2 ** 31).toISOString()} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the farthest time setTimeout can wait for, settle delay included, still schedules a refresh', () => {
    render(<RefreshAt iso={new Date(NOW + 2 ** 31 - 1 - 500).toISOString()} />);
    expect(vi.getTimerCount()).toBe(1);
  });

  test('a time whose settle delay would overflow setTimeout never refreshes', () => {
    render(<RefreshAt iso={new Date(NOW + 2 ** 31 - 1).toISOString()} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a refresh that renders the same time again does not re-arm, so it cannot loop', () => {
    const iso = new Date(NOW + 1_000).toISOString();
    const { rerender } = render(<RefreshAt iso={iso} />);
    vi.advanceTimersByTime(2_000);
    rerender(<RefreshAt iso={iso} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a new time after the refresh arms the next one', () => {
    const { rerender } = render(<RefreshAt iso={new Date(NOW + 1_000).toISOString()} />);
    vi.advanceTimersByTime(2_000);
    rerender(<RefreshAt iso={new Date(NOW + 60_000).toISOString()} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('unmounting cancels the refresh', () => {
    const { unmount } = render(<RefreshAt iso={new Date(NOW + 1_000).toISOString()} />);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
