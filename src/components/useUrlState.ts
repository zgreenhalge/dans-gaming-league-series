'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Patch = Record<string, string | undefined>;

function withPatch(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Navigate the current pathname to a patched query string — the shared primitive every other hook
 * in this file is built on. Multiple keys in one `patch` land in a single navigation, so a change
 * that must reset a sibling param (e.g. toggling a filter also resets an unrelated season-select)
 * never produces two history entries or a lost write.
 */
export function useSetUrlParams(): (patch: Patch, options?: { push?: boolean }) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (patch, options) => {
      const href = pathname + withPatch(searchParams, patch);
      if (options?.push) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [router, pathname, searchParams],
  );
}

/**
 * A single URL-backed value read from the `key` query param. Missing or unparseable values fall
 * back to `defaultValue`, and writing `defaultValue` back removes the param instead of setting it,
 * so a page at its default state has no query string clutter.
 *
 * `push: true` makes the write a `router.push` (new history-stack entry) instead of the default
 * `router.replace` (in place, no back-button stop). Leave this at its default for filters and other
 * continuous adjustments; see `useTabState` for the one case (tab/view switches) that pushes.
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

/**
 * Multiple URL-backed keys written atomically in one navigation. Use this instead of several
 * `useUrlState` calls whenever one interaction must change more than one param at once (e.g. a
 * season-filter toggle that also resets a season-select back to its "all" default) — writing them
 * separately would clobber whichever call lands second, since each starts from the same pre-write
 * `searchParams` snapshot.
 */
export function useUrlStateGroup(options?: { push?: boolean }): (patch: Patch) => void {
  const setParams = useSetUrlParams();
  const push = options?.push;
  return useCallback((patch) => setParams(patch, { push }), [setParams, push]);
}
