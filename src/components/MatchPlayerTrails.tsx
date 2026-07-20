'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReplayPayload, ReplayPlayerMeta } from '@/lib/replay/types';
import { extractPlayerTrace, type PlayerTrace } from '@/lib/replay/aggregate';
import { mapSlug } from '@/lib/maps';
import { isAbortError } from '@/lib/util';
import PlayerRoundOverlay from './PlayerRoundOverlay';

/**
 * The Recap tab's "Pathing" sub-tab (#128): pick one of the match's 4 rostered
 * players and overlay every round of *this match* for them. Fetches its own copy of
 * the replay payload (same endpoint `<ReplayPlayer>` uses) rather than sharing state
 * with the 2D Replay sub-tab, matching the Heatmap sub-tab's independent-lazy-fetch
 * pattern — it only pays that cost when this sub-tab is actually opened.
 */
export default function MatchPlayerTrails({
  matchId,
  matchMap,
  players,
}: {
  matchId: number;
  matchMap: string;
  players: ReplayPlayerMeta[];
}) {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The user's explicit pick; falls back to the first rostered player once it no
  // longer appears in `players` (e.g. this instance is reused for a different match)
  // rather than resetting it via an effect — a derived value, not a second source of
  // truth to keep in sync.
  const [explicitPlayerId, setExplicitPlayerId] = useState<number | null>(null);
  const playerId =
    explicitPlayerId !== null && players.some((p) => p.id === explicitPlayerId)
      ? explicitPlayerId
      : (players[0]?.id ?? null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/matches/${matchId}/replay/payload`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load replay (${res.status})`);
        return (await res.json()) as ReplayPayload;
      })
      .then((p) => setPayload(p))
      .catch((e) => {
        if (!isAbortError(e)) setError(e.message);
      });
    return () => ac.abort();
  }, [matchId]);

  const traces = useMemo<PlayerTrace[]>(() => {
    if (!payload || playerId === null) return [];
    const faction = payload.players.find((p) => p.id === playerId)?.faction ?? null;
    const out: PlayerTrace[] = [];
    for (const round of payload.rounds) {
      const trace = extractPlayerTrace(matchId, round, playerId, faction);
      if (trace) out.push(trace);
    }
    return out;
  }, [payload, playerId, matchId]);

  const selected = players.find((p) => p.id === playerId);

  if (error) {
    return (
      <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-accent-red-fg)]">
        {error}
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-text-secondary)]">
        Loading replay…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-[12px]">
        {players.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setExplicitPlayerId(p.id)}
            className={`border px-2 py-1 font-mono ${
              playerId === p.id
                ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      <PlayerRoundOverlay
        slug={mapSlug(matchMap)}
        traces={traces}
        tickRate={payload.tickRate}
        playerName={selected?.name ?? ''}
      />
    </div>
  );
}
