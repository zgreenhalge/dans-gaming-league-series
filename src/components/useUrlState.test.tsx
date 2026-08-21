// @vitest-environment jsdom
/**
 * Unit tests for `useUrlState.ts` — the shared URL-backed state primitive behind issue #90's
 * navigation work. Covers default-value fallback, the `parse` option, the "writing the default
 * removes the param" behavior, push-vs-replace, and `useUrlStateGroup`'s atomic multi-key writes.
 * `next/navigation` is mocked; the mock's `searchParams`/`pathname` are mutable via
 * `setSearchParams`/`setPathname` so each test can start from a different URL.
 *
 * Run:  npx vitest run src/components/useUrlState.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSetUrlParams, useUrlState, useUrlStateGroup } from './useUrlState';

const { pushMock, replaceMock, getSearchParams, setSearchParams, getPathname, setPathname } = vi.hoisted(() => {
  let searchParams = new URLSearchParams('');
  let pathname = '/example';
  return {
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
    getSearchParams: () => searchParams,
    setSearchParams: (qs: string) => { searchParams = new URLSearchParams(qs); },
    getPathname: () => pathname,
    setPathname: (p: string) => { pathname = p; },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => getPathname(),
  useSearchParams: () => getSearchParams(),
}));

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  setSearchParams('');
  setPathname('/example');
});

describe('useUrlState', () => {
  test('falls back to defaultValue when the param is missing', () => {
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    expect(result.current[0]).toBe('leaderboard');
  });

  test('reads the current value from the URL', () => {
    setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    expect(result.current[0]).toBe('h2h');
  });

  test('falls back to defaultValue when `parse` rejects the raw value', () => {
    setSearchParams('season=not-a-number');
    const { result } = renderHook(() =>
      useUrlState('season', 'all', {
        parse: (raw) => (raw === 'all' ? 'all' : (/^\d+$/.test(raw) ? raw : undefined)),
      }),
    );
    expect(result.current[0]).toBe('all');
  });

  test('setValue replaces (not pushes) by default, patching only its own key', () => {
    setSearchParams('other=1');
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard'));
    act(() => result.current[1]('h2h'));

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    const [href] = replaceMock.mock.calls[0];
    expect(href).toBe('/example?other=1&tab=h2h');
  });

  test('setValue pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useUrlState<'leaderboard' | 'h2h'>('tab', 'leaderboard', { push: true }));
    act(() => result.current[1]('h2h'));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test('setValue(defaultValue) removes the param instead of writing it', () => {
    setSearchParams('tab=h2h');
    const { result } = renderHook(() => useUrlState('tab', 'leaderboard'));
    act(() => result.current[1]('leaderboard'));

    const [href] = replaceMock.mock.calls[0];
    expect(href).toBe('/example');
  });
});

describe('useSetUrlParams', () => {
  test('deletes a key when its patch value is undefined', () => {
    setSearchParams('tab=h2h&season=3');
    const { result } = renderHook(() => useSetUrlParams());
    act(() => result.current({ season: undefined }));

    const [href] = replaceMock.mock.calls[0];
    expect(href).toBe('/example?tab=h2h');
  });
});

describe('useUrlStateGroup', () => {
  test('writes multiple keys in a single navigation', () => {
    setSearchParams('filter=3');
    const { result } = renderHook(() => useUrlStateGroup());
    act(() => result.current({ filter: undefined, reg: '0' }));

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const [href] = replaceMock.mock.calls[0];
    expect(href).toBe('/example?reg=0');
  });

  test('pushes when `push: true` is passed', () => {
    const { result } = renderHook(() => useUrlStateGroup({ push: true }));
    act(() => result.current({ tab: 'h2h' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
