'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSetUrlParams } from './useUrlState';
import type { H2HPair } from './H2HMatrix';

/** Resolves an `H2HPair` (by player id) from `a`/`b`/`type` URL params (`a`/`b` are player names,
 * matched case-insensitively — the same encoding `h2hPairToParams` writes). `null` if either name is
 * absent or doesn't match a known player. */
export function parseH2HPairFromParams(
  searchParams: URLSearchParams,
  players: { id: number; name: string }[],
): H2HPair | null {
  const aName = searchParams.get('a');
  const bName = searchParams.get('b');
  if (!aName || !bName) return null;
  const a = players.find((p) => p.name.toLowerCase() === aName.toLowerCase());
  const b = players.find((p) => p.name.toLowerCase() === bName.toLowerCase());
  if (!a || !b) return null;
  const type = searchParams.get('type') === 'opponent' ? 'opponent' : 'partner';
  return { a: a.id, b: b.id, type };
}

/** The inverse of `parseH2HPairFromParams` — an `H2HSection` `onPairChange` handler's pair (by
 * player id) into the `a`/`b`/`type` patch to hand `useSetUrlParams()`. `type` omits itself for the
 * default `'partner'`, matching this codebase's "writing the default removes the param" convention. */
export function h2hPairToParams(
  pair: H2HPair,
  players: { id: number; name: string }[],
): { a?: string; b?: string; type?: string } {
  return {
    a: players.find((p) => p.id === pair.a)?.name,
    b: players.find((p) => p.id === pair.b)?.name,
    type: pair.type === 'opponent' ? 'opponent' : undefined,
  };
}

/**
 * URL-backed H2H pair (`a`/`b`/`type` params) — shared by every view that renders `H2HSection`
 * (`CareerStatsView`, `SeasonTabView`, `MapDetailView`), so each gets read+write sync from one hook
 * call instead of its own copy of the same `useMemo`/handler pair.
 *
 * Depends on the individual `a`/`b`/`type` param values, not the `searchParams` object itself —
 * Next.js hands back a new `searchParams` object on every navigation (see `useUrlState.ts`'s own
 * docstring on this), so memoizing on the object would re-run `parseH2HPairFromParams`'s player
 * lookups on every unrelated URL change (a season-filter toggle, a tab switch, a week/round expand).
 */
export function useH2HPairUrlState(
  players: { id: number; name: string }[],
): { initialPair: H2HPair | null; onPairChange: (pair: H2HPair) => void } {
  const searchParams = useSearchParams();
  const setUrlParams = useSetUrlParams();
  const aRaw = searchParams.get('a');
  const bRaw = searchParams.get('b');
  const typeRaw = searchParams.get('type');

  const initialPair = useMemo(
    () => parseH2HPairFromParams(searchParams, players),
    // Depend on the raw param values above, not `searchParams` itself — see this function's
    // docstring for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aRaw, bRaw, typeRaw, players],
  );

  function onPairChange(pair: H2HPair) {
    setUrlParams(h2hPairToParams(pair, players));
  }

  return { initialPair, onPairChange };
}
