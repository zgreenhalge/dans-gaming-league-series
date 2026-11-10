// @vitest-environment jsdom
/**
 * Component tests for `RefreshAt`: it refreshes the router shortly after the given time, measured
 * from the server's render time rather than the viewer's clock (straight away for a time already
 * past), and never for a time too far out for `setTimeout`.
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
const at = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('RefreshAt', () => {
  test('refreshes once the time arrives, not before', () => {
    render(<RefreshAt iso={at(NOW + 60_000)} serverNow={NOW} />);
    vi.advanceTimersByTime(60_000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a viewer clock running ahead of the server still waits for the server to pass the time', () => {
    vi.setSystemTime(NOW + 5_000);
    render(<RefreshAt iso={at(NOW + 60_000)} serverNow={NOW} />);
    vi.advanceTimersByTime(60_000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time already past refreshes straight away', () => {
    render(<RefreshAt iso={at(NOW - 60_000)} serverNow={NOW} />);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('a time too far out for setTimeout never refreshes', () => {
    render(<RefreshAt iso={at(NOW + 2 ** 31)} serverNow={NOW} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the farthest time setTimeout can wait for, settle delay included, still schedules a refresh', () => {
    render(<RefreshAt iso={at(NOW + 2 ** 31 - 1 - 500)} serverNow={NOW} />);
    expect(vi.getTimerCount()).toBe(1);
  });

  test('a time whose settle delay would overflow setTimeout never refreshes', () => {
    render(<RefreshAt iso={at(NOW + 2 ** 31 - 1)} serverNow={NOW} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('the next time rendered after the refresh arms the next one', () => {
    const { rerender } = render(<RefreshAt iso={at(NOW + 1_000)} serverNow={NOW} />);
    vi.advanceTimersByTime(2_000);
    rerender(<RefreshAt iso={at(NOW + 60_000)} serverNow={NOW + 2_000} />);
    vi.advanceTimersByTime(58_000 - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('unmounting cancels the refresh', () => {
    const { unmount } = render(<RefreshAt iso={at(NOW + 1_000)} serverNow={NOW} />);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
