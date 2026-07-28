'use client';

// The big centered score under the match header — one component covers both states so a live match
// and a played one render in the identical spot with identical numerals. Before the match is played,
// this drives itself off `live_match_score` the same way the old standalone `LiveScoreTicker` did:
// self-hides until MatchZy reports `going_live` (seeded 0-0), updates on every `round_end` via
// Supabase Realtime (no polling), and self-hides again once `writeMatchScore()` clears the row — see
// `src/lib/demo/liveScore.ts`'s header comment for why that's the right trigger. Once `played` is
// true, it renders the final score from the `matches` row instead and the live wiring never mounts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase-browser';
import { rowToLiveScore, createLiveScoreGuard, type LiveScoreRow, type LiveScoreDbRow } from '@/lib/demo/liveScore';
import { LiveDot } from '@/components/ServerStatusBits';

type Faction = 'CT' | 'T' | null;

function factionClass(f: Faction): string {
  if (f === 'CT') return 'faction-ct';
  if (f === 'T') return 'faction-t';
  return '';
}

function ScoreDisplay({ shirts, skins, shirtsF, skinsF }: { shirts: number; skins: number; shirtsF: Faction; skinsF: Faction }) {
  return (
    <div className="flex items-baseline justify-center gap-5 flex-wrap">
      <div className={`${factionClass(shirtsF)} flex items-baseline gap-3`}>
        <span className="font-display text-[24px] font-bold faction-fg">Shirts</span>
        <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum [text-shadow:-1px_-1px_0_black,1px_-1px_0_black,-1px_1px_0_black,1px_1px_0_black]">
          {shirts}
        </span>
      </div>
      <span className="font-mono text-[24px] text-[var(--color-text-secondary)]">—</span>
      <div className={`${factionClass(skinsF)} flex items-baseline gap-3`}>
        <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum [text-shadow:-1px_-1px_0_black,1px_-1px_0_black,-1px_1px_0_black,1px_1px_0_black]">
          {skins}
        </span>
        <span className="font-display text-[24px] font-bold faction-fg">Skins</span>
      </div>
    </div>
  );
}

export default function MatchScoreHero({
  matchId,
  played,
  vetoComplete,
  finalScore,
  shirtsF,
  skinsF,
}: {
  matchId: number;
  played: boolean;
  /** A live score can only ever exist once veto resolves and a server can go live — before that,
   *  skip mounting the fetch/subscription entirely rather than opening a Realtime channel that can
   *  never receive anything (e.g. a match still weeks from its veto window). */
  vetoComplete: boolean;
  finalScore: { shirts: number; skins: number } | null;
  shirtsF: Faction;
  skinsF: Faction;
}) {
  const liveEligible = !played && vetoComplete;
  const [liveScore, setLiveScore] = useState<LiveScoreRow | null>(null);
  // Guards the initial GET and the Realtime subscription (which start concurrently and race) against
  // a stale result landing after a newer one already has.
  const guardRef = useRef(createLiveScoreGuard());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/live-score`);
      if (!res.ok) return;
      const data = (await res.json()) as { liveScore: LiveScoreRow | null };
      if (data.liveScore && !guardRef.current(matchId, data.liveScore.updatedAt)) return;
      setLiveScore(data.liveScore);
    } catch {
      /* transient — Realtime will still deliver updates */
    }
  }, [matchId]);

  useEffect(() => {
    if (!liveEligible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [liveEligible, refresh]);

  useEffect(() => {
    if (!liveEligible) return;
    const channel = getBrowserClient()
      .channel(`live-score-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_match_score', filter: `match_id=eq.${matchId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            guardRef.current(matchId, 'deleted');
            setLiveScore(null);
            return;
          }
          const row = payload.new as LiveScoreDbRow;
          if (!guardRef.current(matchId, row.updated_at)) return;
          setLiveScore(rowToLiveScore(matchId, row));
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [liveEligible, matchId]);

  if (played) {
    if (!finalScore) return null;
    return (
      <div className="mt-5">
        <ScoreDisplay shirts={finalScore.shirts} skins={finalScore.skins} shirtsF={shirtsF} skinsF={skinsF} />
      </div>
    );
  }

  if (!liveScore) return null;

  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent-green-fg)]">
        <LiveDot />
        Live
      </div>
      <ScoreDisplay shirts={liveScore.shirts} skins={liveScore.skins} shirtsF={shirtsF} skinsF={skinsF} />
    </div>
  );
}
