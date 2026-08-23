import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { UrlStateProvider } from '@/components/UrlStateProvider';

/**
 * `@testing-library/react`'s `render()`, wrapped in a `<UrlStateProvider>` — every component under
 * test that calls `useUrlState`/`useTabState`/`useSeasonFilter`/`useH2HPairUrlState`/
 * `useSetUrlParams` needs one ancestor (see `UrlStateProvider.tsx`). Still expects the calling test
 * file to mock `next/navigation` itself (`vi.mock('next/navigation', () =>
 * createNextNavigationMock())` — see `mockNextNavigation.ts`), since `UrlStateProvider`'s own
 * `usePathname`/`useSearchParams` calls read from that mock.
 */
export function renderWithUrlState(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: UrlStateProvider, ...options });
}

/** `renderHook()`'s `wrapper` option, for hooks in the `useUrlState` family tested via `renderHook`. */
export function urlStateWrapper({ children }: { children: ReactNode }) {
  return <UrlStateProvider>{children}</UrlStateProvider>;
}
