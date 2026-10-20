'use client';

import { useCallback, useMemo } from 'react';
import { useSetUrlParams } from './useUrlState';
import { useUrlStateContext } from './UrlStateProvider';
import type { H2HPair } from './H2HMatrix';
import { DEFAULT_H2H_PAIR_TYPE, H2H_PAIR_PARAM, readH2HPairNames } from '@/lib/h2hPairParams';

/** Resolves an `H2HPair` (by player id) from `a`/`b`/`type` URL params (`a`/`b` are player names,
 * matched case-insensitively — the encoding in `src/lib/h2hPairParams.ts`). `null` if either name is
 * absent or doesn't match a known player. */
export function parseH2HPairFromParams(
  searchParams: URLSearchParams,
  players: { id: number; name: string }[],
): H2HPair | null {
  const names = readH2HPairNames(searchParams);
  if (!names) return null;
  const a = players.find((p) => p.name.toLowerCase() === names.aName.toLowerCase());
  const b = players.find((p) => p.name.toLowerCase() === names.bName.toLowerCase());
  if (!a || !b) return null;
  return { a: a.id, b: b.id, type: names.type };
}

/** The inverse of `parseH2HPairFromParams` — an `H2HSection` `onPairChange` handler's pair (by
 * player id) into the `a`/`b`/`type` patch to hand `useSetUrlParams()`. `type` omits itself for the
 * default, matching this codebase's "writing the default removes the param" convention. */
export function h2hPairToParams(
  pair: H2HPair,
  players: { id: number; name: string }[],
): { a?: string; b?: string; type?: string } {
  return {
    [H2H_PAIR_PARAM.a]: players.find((p) => p.id === pair.a)?.name,
    [H2H_PAIR_PARAM.b]: players.find((p) => p.id === pair.b)?.name,
    [H2H_PAIR_PARAM.type]: pair.type === DEFAULT_H2H_PAIR_TYPE ? undefined : pair.type,
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
  const { searchParams } = useUrlStateContext();
  const setUrlParams = useSetUrlParams();
  const aRaw = searchParams.get(H2H_PAIR_PARAM.a);
  const bRaw = searchParams.get(H2H_PAIR_PARAM.b);
  const typeRaw = searchParams.get(H2H_PAIR_PARAM.type);

  const initialPair = useMemo(
    () => parseH2HPairFromParams(searchParams, players),
    // Depend on the raw param values above, not `searchParams` itself — see this function's
    // docstring for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aRaw, bRaw, typeRaw, players],
  );

  // Stable identity across unrelated re-renders, matching `useSetUrlParams`'s own callback and
  // `useUrlState`'s `setValue` — so a consumer can safely put this in its own `useEffect`/`useMemo`
  // deps or hand it to a memoized child without it changing on every render.
  const onPairChange = useCallback(
    (pair: H2HPair) => {
      setUrlParams(h2hPairToParams(pair, players));
    },
    [setUrlParams, players],
  );

  return { initialPair, onPairChange };
}
