'use client';

// Live in-match score — appears once MatchZy reports `going_live` (seeded 0-0) and updates on every
// `round_end`, well before the demo exists. Updates via Supabase Realtime on the `live_match_score`
// table (no polling) — the same pattern `MatchServerPanel` uses for the `matches` row. Self-hides once
// its row is deleted, which `writeMatchScore()` does as soon as the match has an actual score (see
// `liveScore.ts`'s header comment for why that's the right trigger, not `map_result`) — so there's no
// gap where neither this nor a real result is visible.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase-browser';
import { rowToLiveScore, type LiveScoreRow, type LiveScoreDbRow } from '@/lib/demo/liveScore';

export default function LiveScoreTicker({ matchId }: { matchId: number }) {
  const [score, setScore] = useState<LiveScoreRow | null>(null);
  // The initial GET and the Realtime subscription below start concurrently and race — a slow GET can
  // resolve after Realtime has already delivered a newer update (or a delete). Tracks the freshest
  // state actually applied so either side can tell a stale result apart from a newer one instead of
  // trusting arrival order. 'deleted' is terminal: once a match's live score is cleared it's done for
  // good, so nothing later should be able to un-delete it for this component's lifetime.
  const latestRef = useRef<string | 'deleted' | null>(null);

  // Initial read (Realtime only delivers subsequent changes).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/live-score`);
      if (!res.ok) return;
      const data = (await res.json()) as { liveScore: LiveScoreRow | null };
      if (latestRef.current === 'deleted') return;
      if (data.liveScore) {
        if (latestRef.current && data.liveScore.updatedAt <= latestRef.current) return;
        latestRef.current = data.liveScore.updatedAt;
      }
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
            latestRef.current = 'deleted';
            setScore(null);
            return;
          }
          const row = payload.new as LiveScoreDbRow;
          latestRef.current = row.updated_at;
          setScore(rowToLiveScore(matchId, row));
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
