'use client';

// Live in-match score — appears once MatchZy reports `going_live` (seeded 0-0) and updates on every
// `round_end`, well before the demo exists. Polling-based rather than Supabase Realtime: the data
// lives in R2 (`liveScore.ts`), not a Postgres row, so there's nothing to subscribe to — same
// reasoning as `ScrimStatusContext`'s shared poll. Self-hides when there's nothing live yet, or once
// the match has a confirmed score (the ticker's job is done — `RoundHistoryStrip` takes over).

import { useCallback, useEffect, useState } from 'react';

const POLL_MS = 10_000;

interface LiveScore {
  event: string;
  shirts: number;
  skins: number;
  round: number | null;
}

export default function LiveScoreTicker({ matchId }: { matchId: number }) {
  const [score, setScore] = useState<LiveScore | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/live-score`);
      if (!res.ok) return;
      const data = (await res.json()) as { liveScore: LiveScore | null };
      setScore(data.liveScore);
    } catch {
      /* transient — next poll will retry */
    }
  }, [matchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refresh();
    })();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh]);

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
