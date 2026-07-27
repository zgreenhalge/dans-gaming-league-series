'use client';

// Live in-match score — appears once MatchZy reports `going_live` (seeded 0-0) and updates on every
// `round_end`, well before the demo exists. Updates via Supabase Realtime on the `live_match_score`
// table (no polling) — the same pattern `MatchServerPanel` uses for the `matches` row. Self-hides once
// its row is deleted, which `demo-ingest.ts` does as soon as it has something to show in its place (an
// auto-committed score or a staged review), not at `map_result` — so there's no gap where neither this
// nor the replacement is visible.

import { useCallback, useEffect, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase-browser';
import type { LiveScoreRow } from '@/lib/demo/liveScore';

export default function LiveScoreTicker({ matchId }: { matchId: number }) {
  const [score, setScore] = useState<LiveScoreRow | null>(null);

  // Initial read (Realtime only delivers subsequent changes).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/live-score`);
      if (!res.ok) return;
      const data = (await res.json()) as { liveScore: LiveScoreRow | null };
      setScore(data.liveScore);
    } catch {
      /* transient — Realtime will still deliver updates */
    }
  }, [matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Live updates straight off the live_match_score row — no polling.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel(`live-score-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_match_score', filter: `match_id=eq.${matchId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setScore(null);
            return;
          }
          const row = payload.new as { shirts_score: number; skins_score: number; round: number | null };
          setScore({ matchId, shirts: row.shirts_score, skins: row.skins_score, round: row.round });
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [matchId]);

  if (!score) return null;

  return (
    <div className="lift-card rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-4 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Live
      </div>
      <div className="flex items-baseline gap-2 text-sm text-[var(--color-text-primary)]">
        <span className="font-display text-lg font-bold">
          Shirts {score.shirts} – {score.skins} Skins
        </span>
        {score.round !== null && (
          <span className="text-xs text-[var(--color-text-secondary)]">round {score.round}</span>
        )}
      </div>
    </div>
  );
}
