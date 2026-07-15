'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlayerHistoryRow } from '@/lib/queries';
import type { PlayerTrace } from '@/lib/replay/aggregate';
import { isPlayedScore, tabCls } from '@/lib/util';
import { mapSlug } from '@/lib/maps';
import PlayerRoundOverlay from './PlayerRoundOverlay';

/**
 * The player page's career-wide "replay all of a player's rounds" tab (#128): pick one
 * map the player has played, and overlay every round they've played on it across every
 * match with a ready replay (respecting the page's own season filter — `history` is
 * already filtered by the caller). Positions only make sense on one map at a time, so
 * unlike the match-level version (`MatchPlayerTrails`, scoped to a single match/map
 * already) this needs a map picker up front.
 */
export default function PlayerTrailsTab({
  playerId,
  playerName,
  history,
}: {
  playerId: number;
  playerName: string;
  history: PlayerHistoryRow[];
}) {
  const mapOptions = useMemo(() => {
    const byMap = new Map<string, number[]>();
    for (const r of history) {
      if (!r.map || !isPlayedScore(r.final_score)) continue;
      const arr = byMap.get(r.map) ?? [];
      arr.push(r.match_id);
      byMap.set(r.map, arr);
    }
    return [...byMap.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [history]);

  // The user's explicit pick; falls back to the most-played map once it no longer
  // appears in `mapOptions` (e.g. the season filter flips) rather than resetting it
  // via an effect — a derived value, not a second source of truth to keep in sync.
  const [explicitMap, setExplicitMap] = useState<string | null>(null);
  const selectedMap =
    explicitMap !== null && mapOptions.some(([m]) => m === explicitMap) ? explicitMap : (mapOptions[0]?.[0] ?? null);

  const matchIds = useMemo(
    () => mapOptions.find(([m]) => m === selectedMap)?.[1] ?? [],
    [mapOptions, selectedMap],
  );

  const [traces, setTraces] = useState<PlayerTrace[] | null>(null);
  const [tickRate, setTickRate] = useState(64);
  // Which map the current `traces` were fetched for — lets the render below hold off
  // showing a previous map's rounds on the newly-selected map's radar while a fetch
  // for the new selection is still in flight.
  const [tracesFor, setTracesFor] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/players/${playerId}/replay-trails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matchIds }),
    })
      .then((res) => (res.ok ? res.json() : { traces: [], tickRate: null }))
      .then((body) => {
        if (cancelled) return;
        setTraces(body.traces ?? []);
        setTracesFor(selectedMap);
        if (body.tickRate) setTickRate(body.tickRate);
      })
      .catch(() => {
        if (cancelled) return;
        setTraces([]);
        setTracesFor(selectedMap);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, matchIds, selectedMap]);

  if (mapOptions.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No played matches for this selection.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {mapOptions.map(([m, ids]) => (
          <button
            key={m}
            type="button"
            className={tabCls(selectedMap === m)}
            onClick={() => setExplicitMap(m)}
          >
            {m}
            <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
              ({ids.length})
            </span>
          </button>
        ))}
      </div>
      {traces === null || tracesFor !== selectedMap ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">Loading rounds…</div>
      ) : (
        <PlayerRoundOverlay
          slug={mapSlug(selectedMap ?? '')}
          traces={traces}
          tickRate={tickRate}
          playerName={playerName}
        />
      )}
    </div>
  );
}
