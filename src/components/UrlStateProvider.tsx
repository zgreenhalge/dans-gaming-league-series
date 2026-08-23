'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

interface UrlStateContextValue {
  pathname: string;
  searchParams: URLSearchParams;
  /** Kept in sync after every commit (see `useUrlState.ts`'s `useSetUrlParams` docstring for why a
   *  ref rather than a `useCallback` dep) so every `useSetUrlParams()` caller's write reads the
   *  latest URL through this one subscription instead of registering its own. */
  latestRef: { current: { pathname: string; searchParams: URLSearchParams } };
}

const UrlStateContext = createContext<UrlStateContextValue | null>(null);

/**
 * Mounts the single `usePathname()`/`useSearchParams()` subscription every URL-backed hook in this
 * codebase (`useUrlState`, `useTabState`, `useSeasonFilter`, `useH2HPairUrlState`, `useSetUrlParams`)
 * reads from, instead of each hook instance subscribing independently. See `useUrlStateContext()`.
 *
 * Calls `useSearchParams()`, which requires a `<Suspense>` boundary on any statically-rendered page —
 * mount this nested inside a page's existing `<Suspense>` wrapper (`<Suspense><UrlStateProvider>
 * {clientTree}</UrlStateProvider></Suspense>`), never in the root layout, which has no boundary today
 * and would force one app-wide if wrapped.
 */
export function UrlStateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const latestRef = useRef({ pathname, searchParams });
  useEffect(() => {
    latestRef.current = { pathname, searchParams };
  });

  return (
    <UrlStateContext.Provider value={{ pathname, searchParams, latestRef }}>
      {children}
    </UrlStateContext.Provider>
  );
}

/** Throws when called outside a `<UrlStateProvider>` — every URL-backed hook needs one ancestor. */
export function useUrlStateContext(): UrlStateContextValue {
  const ctx = useContext(UrlStateContext);
  if (!ctx) throw new Error('URL-state hooks must be used within <UrlStateProvider>');
  return ctx;
}
