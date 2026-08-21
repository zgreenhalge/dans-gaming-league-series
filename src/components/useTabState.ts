'use client';

import { useUrlState } from './useUrlState';

/**
 * URL-backed tab selection. Every tab bar in the app should use this instead of a local
 * `useState<Tab>`, so a tab switch is the one interaction that pushes a browser-history entry (see
 * `useUrlState`'s `push` option) — everything else (filters, sub-selections) replaces in place.
 * Centralizing that choice here means changing it later — e.g. making tabs replace too, or making
 * some other interaction push — is a one-line change in one place, not a per-component decision.
 *
 * Falls back to `defaultTab` when the URL names a tab that isn't in `tabs` (e.g. a tab hidden
 * because its data doesn't exist for this viewer), mirroring the fallback `SeasonTabView` already
 * computes inline today.
 */
export function useTabState<T extends string>(
  tabs: readonly T[],
  defaultTab: T,
  param = 'tab',
): [T, (next: T) => void] {
  const [raw, setRaw] = useUrlState<T>(param, defaultTab, { push: true });
  const value = tabs.includes(raw) ? raw : defaultTab;
  return [value, setRaw];
}

/**
 * Falls back to the first entry in `available` when `raw` (from `useTabState`) doesn't name one of
 * them — the second-stage check every tab bar needs once its tab list is computed dynamically (e.g.
 * hidden until data exists for this viewer), since `useTabState`'s own validity check only knows the
 * full static key list, not which of those keys currently has something to show.
 */
export function resolveTab<T extends string>(raw: T, available: readonly { key: T }[]): T {
  return available.some((t) => t.key === raw) ? raw : (available[0]?.key ?? raw);
}
