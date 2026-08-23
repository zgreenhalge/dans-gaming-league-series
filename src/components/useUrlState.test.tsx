// @vitest-environment jsdom
/**
 * Unit tests for `useUrlState.ts` — the shared URL-backed state primitive behind issue #90's
 * navigation work. Covers default-value fallback, the `parse` option, the "writing the default
 * removes the param" behavior, push-vs-replace, `useSetUrlParams`'s atomic multi-key writes, and the
 * returned setters' stable identity across unrelated URL changes.
 *
 * Writes go through `window.history.pushState`/`replaceState`, not `useRouter()` — see
 * `useSetUrlParams`'s docstring for why. `history.pushState(state, unused, url)` puts the URL in the
 * *third* argument, so assertions below read `.mock.calls[0][2]`, not `[0]`.
 *
 * Run:  npx vitest run src/components/useUrlState.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import { useSetUrlParams, useUrlState } from './useUrlState';

vi.mock('next/navigation', () => createNextNavigationMock());

beforeEach(resetNextNavigationMock);

describe('useUrlState', () => {
  test('falls back to defaultValue when the param is missing', () => {
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'), { wrapper: UrlStateProvider });
    expect(result.current[0]).toBe('leaderboard');
  });

  test('reads the current value from the URL', () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'), { wrapper: UrlStateProvider });
    expect(result.current[0]).toBe('h2h');
  });

  test('falls back to defaultValue when `parse` rejects the raw value', () => {
    nextNavigationMock.setSearchParams('season=not-a-number');
    const { result } = renderHook(
      () =>
        useUrlState('season', 'all', {
          parse: (raw) => (raw === 'all' ? 'all' : (/^\d+$/.test(raw) ? raw : undefined)),
        }),
      { wrapper: UrlStateProvider },
    );
    expect(result.current[0]).toBe('all');
  });

  test('setValue replaces (not pushes) by default, patching only its own key', () => {
    nextNavigationMock.setSearchParams('other=1');
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard'), { wrapper: UrlStateProvider });
    act(() => result.current[1]('h2h'));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.pushState).not.toHaveBeenCalled();
    const href = nextNavigationMock.replaceState.mock.calls[0][2];
    expect(href).toBe('/example?other=1&tab=h2h');
  });

  test('setValue pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard', { push: true }), { wrapper: UrlStateProvider });
    act(() => result.current[1]('h2h'));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
  });

  test('setValue(defaultValue) removes the param instead of writing it', () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'), { wrapper: UrlStateProvider });
    act(() => result.current[1]('leaderboard'));

    const href = nextNavigationMock.replaceState.mock.calls[0][2];
    expect(href).toBe('/example');
  });

  test("setValue's identity is stable across renders caused by an unrelated URL change", () => {
    const { result, rerender } = renderHook(() => useUrlState('tab', 'leaderboard'), { wrapper: UrlStateProvider });
    const first = result.current[1];

    nextNavigationMock.setSearchParams('other=1');
    rerender();

    expect(result.current[1]).toBe(first);
  });
});

describe('useSetUrlParams', () => {
  test('deletes a key when its patch value is undefined', () => {
    nextNavigationMock.setSearchParams('tab=h2h&season=3');
    const { result } = renderHook(() => useSetUrlParams(), { wrapper: UrlStateProvider });
    act(() => result.current({ season: undefined }));

    const href = nextNavigationMock.replaceState.mock.calls[0][2];
    expect(href).toBe('/example?tab=h2h');
  });

  test('writes multiple keys in a single navigation', () => {
    nextNavigationMock.setSearchParams('filter=3');
    const { result } = renderHook(() => useSetUrlParams(), { wrapper: UrlStateProvider });
    act(() => result.current({ filter: undefined, reg: '0' }));

    expect(nextNavigationMock.replaceState).toHaveBeenCalledTimes(1);
    const href = nextNavigationMock.replaceState.mock.calls[0][2];
    expect(href).toBe('/example?reg=0');
  });

  test('pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useSetUrlParams(), { wrapper: UrlStateProvider });
    act(() => result.current({ tab: 'h2h' }, { push: true }));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
  });

  test('identity is stable across renders caused by an unrelated URL change', () => {
    const { result, rerender } = renderHook(() => useSetUrlParams(), { wrapper: UrlStateProvider });
    const first = result.current;

    nextNavigationMock.setSearchParams('other=1');
    rerender();

    expect(result.current).toBe(first);
  });
});
