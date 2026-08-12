'use client';

// Site-wide "a match is live" ticker, mounted once in the root layout below the fixed topbar. The
// league runs one shared match server (#134), so at most one match is ever live — this shows that
// match's title and running score to every visitor, not just whoever's on its match page.
//
// Sourced the same way `MatchScoreHero` sources its own per-match live score: an initial GET
// (`/api/live-match`) racing a Realtime subscription on `live_match_score`, no polling. Score updates
// for the currently-ticked match are patched in place from the Realtime payload; any change that isn't
// the current match (a new match going live, or nothing live anymore) triggers a refetch, since that's
// the only path that needs the joined title/roster data the payload doesn't carry.
//
// Reserves its own space via the `--ticker-h` CSS var (read by the root layout's content padding and
// `SideNav`'s sticky offset) instead of overlapping content — set on `<html>` so the server-rendered
// initial value and this component's later updates target the same property with no hydration flash.
//
// Suppressed on the live match's own page — `MatchScoreHero` already shows its live score there, so
// the ticker would just be a second copy of the same number a few pixels away.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';
import { LiveDot } from '@/components/ServerStatusBits';
import { createLiveScoreGuard, type LiveScoreDbRow } from '@/lib/demo/liveScore';
import type { LiveTickerMatch } from '@/lib/queries';

export const TICKER_HEIGHT_PX = 34;

export function LiveMatchTicker({ initial }: { initial: LiveTickerMatch | null }) {
  const pathname = usePathname();
  const [ticker, setTicker] = useState<LiveTickerMatch | null>(initial);
  const tickerRef = useRef(ticker);
  useEffect(() => {
    tickerRef.current = ticker;
  }, [ticker]);
  // Guards against a slow GET landing after a Realtime event already applied a newer (or terminal)
  // update — for whichever match is currently being tracked, which can change over time as different
  // matches go live (unlike MatchScoreHero, which only ever tracks one fixed match).
  const guardRef = useRef(createLiveScoreGuard());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/live-match');
      if (!res.ok) return;
      const data = (await res.json()) as { ticker: LiveTickerMatch | null };
      if (data.ticker && !guardRef.current(data.ticker.matchId, data.ticker.updatedAt)) return;
      setTicker(data.ticker);
    } catch {
      /* transient — Realtime will still deliver updates */
    }
  }, []);

  // `initial` comes from the root layout's ISR-cached render, so it can be up to a minute stale —
  // reconcile against a fresh read as soon as we're mounted, same as the per-match live components.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    const channel = getBrowserClient()
      .channel('live-match-ticker')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_match_score' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { match_id?: number };
            if (old.match_id != null) guardRef.current(old.match_id, 'deleted');
            if (tickerRef.current && old.match_id === tickerRef.current.matchId) setTicker(null);
            return;
          }
          const row = payload.new as LiveScoreDbRow & { match_id: number };
          if (tickerRef.current && tickerRef.current.matchId === row.match_id) {
            if (!guardRef.current(row.match_id, row.updated_at)) return;
            setTicker({ ...tickerRef.current, shirts: row.shirts_score, skins: row.skins_score });
          } else {
            // A different match than what's currently shown (or nothing shown yet) — always fresh, not
            // a race, so don't pre-consume the guard here: `refresh()` fetches the joined title/roster
            // and applies its own guard check against what it gets back. Consuming the guard for
            // `row.match_id` first would make that check see its own just-recorded version and reject
            // the refetch as "not newer," leaving the ticker stuck on the old match.
            refresh();
          }
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [refresh]);

  const visible = ticker != null && pathname !== `/matches/${ticker.matchId}`;

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--ticker-h', visible ? `${TICKER_HEIGHT_PX}px` : '0px');
  }, [visible]);

  if (!visible || !ticker) return null;

  return (
    <Link
      href={`/matches/${ticker.matchId}`}
      className="lift-row fixed left-0 right-0 z-10 flex items-center justify-center gap-2 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-3 text-[12px] overflow-hidden"
      style={{ top: 'var(--topbar-h)', height: `${TICKER_HEIGHT_PX}px` }}
    >
      <span className="flex shrink-0 items-center gap-1.5 font-semibold uppercase tracking-wide text-[var(--color-accent-green-fg)]">
        <LiveDot />
        Live
      </span>
      <span className="hidden truncate text-[var(--color-text-secondary)] sm:inline">{ticker.title}</span>
      <span className="truncate font-mono font-semibold tnum text-[var(--color-text-primary)]">
        {ticker.shirtNames} {ticker.shirts}–{ticker.skins} {ticker.skinNames}
      </span>
    </Link>
  );
}
