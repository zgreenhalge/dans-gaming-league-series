'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type Patch = Record<string, string | undefined>;

function withPatch(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Navigate the current pathname to a patched query string — the shared primitive every other hook
 * in this file is built on, and the one to reach for directly when one interaction must change more
 * than one param at once (e.g. a season-filter toggle that also resets an unrelated season-select
 * back to its "all" default) — writing them via separate calls would clobber whichever lands second,
 * since each starts from the same pre-write `searchParams` snapshot.
 *
 * Writes via `window.history.pushState`/`replaceState` directly, **not** `useRouter().push`/
 * `.replace()`. Without Cache Components enabled (this app doesn't have it on — see
 * `next.config.ts`), `router.push`/`.replace()` to a URL whose query string it hasn't already
 * rendered triggers a full server round-trip that re-runs the page's own Server Component data
 * fetching just to redraw the same shell with a different client-side tab — a very visible pause on
 * every click for a page like the season hub with several `Promise.all`-batched Supabase queries.
 * Raw `history.pushState`/`replaceState` is Next's own documented "shallow routing" answer to this
 * exact problem (see the Next docs' "Shallow routing on the client" guide): it still integrates with
 * `usePathname`/`useSearchParams` (both hooks pick up the change reactively), just without asking
 * the server to re-render anything.
 *
 * Keeps `pathname`/`searchParams` in a ref synced after each commit (never mutated during render,
 * per this codebase's `react-hooks/refs` rule) rather than in the returned callback's `useCallback`
 * deps, so the callback's identity stays stable across navigations instead of changing whenever *any*
 * URL param changes (Next.js hands back a new `searchParams` object on every navigation) — a
 * consumer that puts this setter in its own `useEffect`/`useMemo` deps or hands it to a memoized
 * child won't re-run/re-render on unrelated URL changes.
 */
export function useSetUrlParams(): (patch: Patch, options?: { push?: boolean }) => void {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const latest = useRef({ pathname, searchParams });
  useEffect(() => {
    latest.current = { pathname, searchParams };
  });

  return useCallback((patch, options) => {
    const { pathname, searchParams } = latest.current;
    const href = pathname + withPatch(searchParams, patch);
    if (options?.push) window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  }, []);
}

/**
 * A single URL-backed value read from the `key` query param. Missing or unparseable values fall
 * back to `defaultValue`, and writing `defaultValue` back removes the param instead of setting it,
 * so a page at its default state has no query string clutter.
 *
 * `push: true` makes the write a `history.pushState` (new history-stack entry) instead of the
 * default `history.replaceState` (in place, no back-button stop). Leave this at its default for
 * filters and other continuous adjustments; see `useTabState` for the one case (tab/view switches)
 * that pushes.
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
  options?: { push?: boolean; parse?: (raw: string) => T | undefined },
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const setParams = useSetUrlParams();
  const raw = searchParams.get(key);
  const parsed = raw == null ? undefined : (options?.parse ? options.parse(raw) : (raw as T));
  const value = parsed ?? defaultValue;
  const push = options?.push;

  const setValue = useCallback(
    (next: T) => {
      setParams({ [key]: next === defaultValue ? undefined : next }, { push });
    },
    [setParams, key, defaultValue, push],
  );

  return [value, setValue];
}
