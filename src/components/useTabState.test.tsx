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
import { createNextNavigationMock, nextNavigationMock, resetNextNavigationMock } from '@/lib/test-support/mockNextNavigation';
import { urlStateWrapper } from '@/lib/test-support/renderWithUrlState';
import { useTabState } from './useTabState';

vi.mock('next/navigation', () => createNextNavigationMock());

const TABS = ['leaderboard', 'schedule', 'h2h'] as const;

beforeEach(() => {
  resetNextNavigationMock();
  nextNavigationMock.setPathname('/seasons/3');
});

describe('useTabState', () => {
  test('falls back to defaultTab when the param is missing', () => {
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'), { wrapper: urlStateWrapper });
    expect(result.current[0]).toBe('leaderboard');
  });

  test('falls back to defaultTab when the URL names a tab that is not in the list', () => {
    nextNavigationMock.setSearchParams('tab=advanced');
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'), { wrapper: urlStateWrapper });
    expect(result.current[0]).toBe('leaderboard');
  });

  test('reads a valid tab from the URL', () => {
    nextNavigationMock.setSearchParams('tab=h2h');
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'), { wrapper: urlStateWrapper });
    expect(result.current[0]).toBe('h2h');
  });

  test('setting the tab pushes a history entry, not a replace', () => {
    const { result } = renderHook(() => useTabState(TABS, 'leaderboard'), { wrapper: urlStateWrapper });
    act(() => result.current[1]('schedule'));

    expect(nextNavigationMock.pushState).toHaveBeenCalledTimes(1);
    expect(nextNavigationMock.replaceState).not.toHaveBeenCalled();
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/3?tab=schedule');
  });

  test('supports a custom param name for co-existing tab bars (e.g. `view` + `tab`)', () => {
    nextNavigationMock.setSearchParams('view=gauntlet');
    const { result } = renderHook(() => useTabState(['regular', 'gauntlet'] as const, 'regular', 'view'), { wrapper: urlStateWrapper });
    expect(result.current[0]).toBe('gauntlet');

    act(() => result.current[1]('regular'));
    expect(nextNavigationMock.pushState.mock.calls[0][2]).toBe('/seasons/3');
  });
});
