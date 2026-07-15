'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlayerHistoryRow } from '@/lib/queries';
import type { PlayerTrace } from '@/lib/replay/aggregate';
import { isPlayedScore, tabCls } from '@/lib/util';
import { mapSlug } from '@/lib/maps';
import PlayerRoundOverlay from './PlayerRoundOverlay';

/**
 * The player page's "Pathing" tab (#128) — career-wide "replay all of a player's
 * rounds" view: pick one map the player has played, and overlay every round they've
 * played on it across every match with a ready replay (respecting the page's own
 * season filter — `history` is already filtered by the caller). Positions only make
 * sense on one map at a time, so unlike the match-level version (`MatchPlayerTrails`,
 * scoped to a single match/map already) this needs a map picker up front.
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
  // Grouped by a case/whitespace-normalized key (map names are user-typed strings —
  // see CLAUDE.md), same normalization `aggregateByMap` uses elsewhere in `PlayerView`,
  // but displayed with the first-seen casing. Only matches with a generated replay are
  // candidates — a played match with no replay yet has nothing to fetch, so it's
  // excluded here rather than sent to the API just to come back empty.
  const mapOptions = useMemo(() => {
    const byMap = new Map<string, { display: string; matchIds: number[] }>();
    for (const r of history) {
      if (!r.map || !isPlayedScore(r.final_score) || r.replay_status !== 'ready') continue;
      const key = r.map.trim().toLowerCase();
      const entry = byMap.get(key) ?? { display: r.map.trim(), matchIds: [] };
      entry.matchIds.push(r.match_id);
      byMap.set(key, entry);
    }
    return [...byMap.values()].sort((a, b) => b.matchIds.length - a.matchIds.length);
  }, [history]);

  // The user's explicit pick; falls back to the most-played map once it no longer
  // appears in `mapOptions` (e.g. the season filter flips) rather than resetting it
  // via an effect — a derived value, not a second source of truth to keep in sync.
  const [explicitMap, setExplicitMap] = useState<string | null>(null);
  const selectedMap =
    explicitMap !== null && mapOptions.some((o) => o.display === explicitMap)
      ? explicitMap
      : (mapOptions[0]?.display ?? null);

  const matchIds = useMemo(
    () => mapOptions.find((o) => o.display === selectedMap)?.matchIds ?? [],
    [mapOptions, selectedMap],
  );

  // The fetched traces, the tick rate they share, and which map they were fetched
  // for (so the render below can hold off showing a previous map's rounds on the
  // newly-selected map's radar while a fetch for the new selection is still in
  // flight) — kept as one object so the three always update atomically.
  const [result, setResult] = useState<{ map: string | null; traces: PlayerTrace[]; tickRate: number } | null>(null);
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
        setResult({ map: selectedMap, traces: body.traces ?? [], tickRate: body.tickRate ?? 64 });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ map: selectedMap, traces: [], tickRate: 64 });
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, matchIds, selectedMap]);

  if (mapOptions.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No matches with a generated replay for this selection.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {mapOptions.map((o) => (
          <button
            key={o.display}
            type="button"
            className={tabCls(selectedMap === o.display)}
            onClick={() => setExplicitMap(o.display)}
          >
            {o.display}
            <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
              ({o.matchIds.length})
            </span>
          </button>
        ))}
      </div>
      {result === null || result.map !== selectedMap ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">Loading rounds…</div>
      ) : (
        <PlayerRoundOverlay
          slug={mapSlug(selectedMap ?? '')}
          traces={result.traces}
          tickRate={result.tickRate}
          playerName={playerName}
        />
      )}
    </div>
  );
}
