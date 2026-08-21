// @vitest-environment jsdom
/**
 * Unit tests for `useTabState.ts` — the URL-backed tab hook every tab bar migrates onto for
 * issue #90. Covers the invalid/missing-tab fallback and confirms tab changes push a history entry
 * (the one interaction in the URL-state work that does), unlike `useUrlState`'s replace default.
 *
 * Run:  npx vitest run src/components/useTabState.test.tsx
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTabState } from './useTabState';

const { pushMock, replaceMock, getSearchParams, setSearchParams } = vi.hoisted(() => {
  let searchParams = new URLSearchParams('');
  return {
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
    getSearchParams: () => searchParams,
    setSearchParams: (qs: string) => { searchParams = new URLSearchParams(qs); },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => '/seasons/3',
  useSearchParams: () => getSearchParams(),
}));

const TABS = ['leaderboard', 'schedule', 'h2h'] as const;

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  setSearchParams('');
});

describe('useTabState', () => {
  test('falls back to defaultTab when the param is missing', () => {
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'));
    expect(result.current[0]).toBe('leaderboard');
  });

  test('falls back to defaultTab when the URL names a tab that is not in the list', () => {
    setSearchParams('tab=advanced');
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'));
    expect(result.current[0]).toBe('leaderboard');
  });

  test('reads a valid tab from the URL', () => {
    setSearchParams('tab=h2h');
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'));
    expect(result.current[0]).toBe('h2h');
  });

  test('setting the tab pushes a history entry, not a replace', () => {
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'));
    act(() => result.current[1]('schedule'));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock.mock.calls[0][0]).toBe('/seasons/3?tab=schedule');
  });

  test('supports a custom param name for co-existing tab bars (e.g. `view` + `tab`)', () => {
    setSearchParams('view=gauntlet');
    const { result } = renderHook(() => useTabState(['regular', 'gauntlet'] as const, 'regular', 'view'));
    expect(result.current[0]).toBe('gauntlet');

    act(() => result.current[1]('regular'));
    expect(pushMock.mock.calls[0][0]).toBe('/seasons/3');
  });
});
