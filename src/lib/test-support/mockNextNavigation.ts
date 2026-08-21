import { vi } from 'vitest';

/**
 * Shared mutable state behind a `next/navigation` mock (`useRouter`/`usePathname`/`useSearchParams`),
 * for any hook/component test that reads or writes URL state. A test file still has to call
 * `vi.mock('next/navigation', () => createNextNavigationMock())` itself — `vi.mock` is hoisted
 * per-file and can't be triggered from an imported helper — but the mutable state and reset logic
 * live here once instead of being copy-pasted per test file.
 */
let searchParams = new URLSearchParams('');
let pathname = '/example';

export const nextNavigationMock = {
  push: vi.fn(),
  replace: vi.fn(),
  getSearchParams: () => searchParams,
  setSearchParams: (qs: string) => { searchParams = new URLSearchParams(qs); },
  getPathname: () => pathname,
  setPathname: (p: string) => { pathname = p; },
};

export function createNextNavigationMock() {
  return {
    useRouter: () => ({ push: nextNavigationMock.push, replace: nextNavigationMock.replace }),
    usePathname: () => nextNavigationMock.getPathname(),
    useSearchParams: () => nextNavigationMock.getSearchParams(),
  };
}

/** Call in `beforeEach` to reset the mock router calls and URL back to the default `/example`. */
export function resetNextNavigationMock(): void {
  nextNavigationMock.push.mockReset();
  nextNavigationMock.replace.mockReset();
  nextNavigationMock.setSearchParams('');
  nextNavigationMock.setPathname('/example');
}
