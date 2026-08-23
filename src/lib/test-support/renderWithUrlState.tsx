import type { ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { UrlStateProvider } from '@/components/UrlStateProvider';

/**
 * `@testing-library/react`'s `render()`, wrapped in a `<UrlStateProvider>` — every component under
 * test that calls `useUrlState`/`useTabState`/`useSeasonFilter`/`useH2HPairUrlState`/
 * `useSetUrlParams` needs one ancestor (see `UrlStateProvider.tsx`). Still expects the calling test
 * file to mock `next/navigation` itself (`vi.mock('next/navigation', () =>
 * createNextNavigationMock())` — see `mockNextNavigation.ts`), since `UrlStateProvider`'s own
 * `usePathname`/`useSearchParams` calls read from that mock.
 *
 * For a bare hook under `renderHook()` (no component to render), pass `UrlStateProvider` itself as
 * the `wrapper` option — its `{ children }` signature already matches what `renderHook` expects, so
 * no separate wrapper is needed.
 */
export function renderWithUrlState(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: UrlStateProvider, ...options });
}
