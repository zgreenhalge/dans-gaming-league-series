// @vitest-environment jsdom
/**
 * Unit tests for `useUrlState.ts` — the shared URL-backed state primitive behind issue #90's
 * navigation work. Covers default-value fallback, the `parse` option, the "writing the default
 * removes the param" behavior, push-vs-replace, `useSetUrlParams`'s atomic multi-key writes, and the
 * returned setters' stable identity across unrelated URL changes.
 *
 * Run:  npx vitest run src/components/useUrlState.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { useSetUrlParams, useUrlState } from './useUrlState';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(resetNextNavigationMock);

describe('useUrlState', () => {
  test('falls back to defaultValue when the param is missing', () => {
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    expect(result.current[0]).toBe('leaderboard');
  });

  test('reads the current value from the URL', () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    expect(result.current[0]).toBe('h2h');
  });

  test('falls back to defaultValue when `parse` rejects the raw value', () => {
    nextNavigationMock.setSearchParams('season=not-a-number');
    const { result } = renderHook(() =>
      useUrlState('season', 'all', {
        parse: (raw) => (raw === 'all' ? 'all' : (/^\d+$/.test(raw) ? raw : undefined)),
      }),
    );
    expect(result.current[0]).toBe('all');
  });

  test('setValue replaces (not pushes) by default, patching only its own key', () => {
    nextNavigationMock.setSearchParams('other=1');
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard'));
    act(() => result.current[1]('h2h'));

    expect(nextNavigationMock.replace).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.push).not.toHaveBeenCalled();
    const [href] = nextNavigationMock.replace.mock.calls[0];
    expect(href).toBe('/example?other=1&tab=h2h');
  });

  test('setValue pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard', { push: true }));
    act(() => result.current[1]('h2h'));

    expect(nextNavigationMock.push).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replace).not.toHaveBeenCalled();
  });

  test('setValue(defaultValue) removes the param instead of writing it', () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    act(() => result.current[1]('leaderboard'));

    const [href] = nextNavigationMock.replace.mock.calls[0];
    expect(href).toBe('/example');
  });

  test("setValue's identity is stable across renders caused by an unrelated URL change", () => {
    const { result, rerender } = renderHook(() => useUrlState('tab', 'leaderboard'));
    const first = result.current[1];

    nextNavigationMock.setSearchParams('other=1');
    rerender();

    expect(result.current[1]).toBe(first);
  });
});

describe('useSetUrlParams', () => {
  test('deletes a key when its patch value is undefined', () => {
    nextNavigationMock.setSearchParams('tab=h2h&season=3');
    const { result } = renderHook(() => useSetUrlParams());
    act(() => result.current({ season: undefined }));

    const [href] = nextNavigationMock.replace.mock.calls[0];
    expect(href).toBe('/example?tab=h2h');
  });

  test('writes multiple keys in a single navigation', () => {
    nextNavigationMock.setSearchParams('filter=3');
    const { result } = renderHook(() => useSetUrlParams());
    act(() => result.current({ filter: undefined, reg: '0' }));

    expect(nextNavigationMock.replace).toHaveBeenCalledTimes(1);
    const [href] = nextNavigationMock.replace.mock.calls[0];
    expect(href).toBe('/example?reg=0');
  });

  test('pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useSetUrlParams());
    act(() => result.current({ tab: 'h2h' }, { push: true }));

    expect(nextNavigationMock.push).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replace).not.toHaveBeenCalled();
  });

  test('identity is stable across renders caused by an unrelated URL change', () => {
    const { result, rerender } = renderHook(() => useSetUrlParams());
    const first = result.current;

    nextNavigationMock.setSearchParams('other=1');
    rerender();

    expect(result.current).toBe(first);
  });
});
