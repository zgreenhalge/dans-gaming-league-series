import { vi } from 'vitest';

/**
 * Shared mutable state behind a `next/navigation` mock (`usePathname`/`useSearchParams`), for any
 * hook/component test that reads or writes URL state. A test file still has to call
 * `vi.mock('next/navigation', () => createNextNavigationMock())` itself — `vi.mock` is hoisted
 * per-file and can't be triggered from an imported helper — but the mutable state and reset logic
 * live here once instead of being copy-pasted per test file.
 *
 * `pushState`/`replaceState` spy on the real `window.history` methods, not `useRouter().push`/
 * `.replace()` — `useSetUrlParams` (`src/components/useUrlState.ts`) writes the URL via the native
 * History API directly (Next's "shallow routing" pattern, so a query-only change doesn't trigger a
 * full server round-trip), so `useRouter` isn't part of this mock at all.
 */
let searchParams = new URLSearchParams('');
let pathname = '/example';

export const nextNavigationMock = {
  pushState: vi.spyOn(window.history, 'pushState').mockImplementation(() => {}),
  replaceState: vi.spyOn(window.history, 'replaceState').mockImplementation(() => {}),
  getSearchParams: () => searchParams,
  setSearchParams: (qs: string) => { searchParams = new URLSearchParams(qs); },
  getPathname: () => pathname,
  setPathname: (p: string) => { pathname = p; },
};

export function createNextNavigationMock() {
  return {
    usePathname: () => nextNavigationMock.getPathname(),
    useSearchParams: () => nextNavigationMock.getSearchParams(),
  };
}

/** Call in `beforeEach` to reset the mock history calls and URL back to the default `/example`. */
export function resetNextNavigationMock(): void {
  nextNavigationMock.pushState.mockClear();
  nextNavigationMock.replaceState.mockClear();
  nextNavigationMock.setSearchParams('');
  nextNavigationMock.setPathname('/example');
}
