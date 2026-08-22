'use client';

import { useMemo } from 'react';
import { computeH2H, mapMatchRowsToH2HInput } from '@/lib/h2h';
import type { H2HData } from '@/lib/h2h';

/**
 * Computes `H2HData` live, client-side, from already-loaded match rows and the league's players —
 * shared by every view that renders an H2H tab reactively under its own season filter
 * (`CareerStatsView`, `MapDetailView`, `PlayerView`), so each gets the same
 * `computeH2H(mapMatchRowsToH2HInput(...))` memoization from one hook call instead of its own copy.
 */
export function useLiveH2HData(
  matches: Parameters<typeof mapMatchRowsToH2HInput>[0],
  players: { id: number; name: string; steam_avatar_url: string | null }[],
): H2HData {
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  return useMemo(
    () => computeH2H(mapMatchRowsToH2HInput(matches), playersById),
    [matches, playersById],
  );
}
