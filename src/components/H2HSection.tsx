'use client';

import { useMemo, useState } from 'react';
import EmptyState from './EmptyState';
import H2HMatrix, { type H2HPair } from './H2HMatrix';
import { DuoDetail, RivalDetail } from './MatchupDetail';
import { findDuo, findRival } from '@/lib/h2h';
import type { H2HData } from '@/lib/queries';
import { duoBlendedScorer, rivalBlendedScorer, duoBreakdownScorer, rivalBreakdownScorer, rankDuos, rankRivals } from '@/lib/queries';
import { DuoHeader, DuoRow, RivalHeader, RivalRow } from './H2HRows';
import RatingCircle from './RatingCircle';

function LeagueAvgCircle({ value, colorStart, colorEnd, title }: { value: number; colorStart: string; colorEnd: string; title?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tracked text-[8px] text-[var(--color-text-secondary)]">League Avg</span>
      <RatingCircle value={value} colorStart={colorStart} colorEnd={colorEnd} size="md" title={title} />
    </div>
  );
}

/** Cards, matrix, and detail panels for a set of head-to-head data — shared between the
 * career statistics page and per-season hubs (regular season and gauntlet). `onPairChange`, if
 * given, is called with every explicit selection (a row click, a matrix cell click, a flip button —
 * never a hover preview), so a parent can mirror the active pair into its own URL state without this
 * component knowing anything about routing. */
export default function H2HSection({
  data,
  initialPair,
  onPairChange,
}: {
  data: H2HData;
  initialPair?: H2HPair | null;
  onPairChange?: (pair: H2HPair) => void;
}) {
  const { duos, rivals, players } = data;

  const playersById = useMemo(() => {
    const m = new Map<number, (typeof players)[number]>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const defaultPair = useMemo<H2HPair | null>(() => {
    if (duos.length > 0) return { a: duos[0].playerA, b: duos[0].playerB, type: 'partner' };
    if (rivals.length > 0) return { a: rivals[0].playerA, b: rivals[0].playerB, type: 'opponent' };
    return null;
  }, [duos, rivals]);

  const [sel, setSelRaw] = useState<H2HPair | null>(initialPair ?? defaultPair);
  const [hover, setHover] = useState<H2HPair | null>(null);
  const active = hover ?? sel ?? defaultPair;

  function setSel(pair: H2HPair) {
    setSelRaw(pair);
    onPairChange?.(pair);
  }

  // See "Blended score" in docs/glossary.md. Scorer factories normalise against the full set
  // so the top-5 ranking and matrix gradient stay derived from the same formula.
  const duoScore = useMemo(() => duoBlendedScorer(duos), [duos]);
  const duoBreakdown = useMemo(() => duoBreakdownScorer(duos), [duos]);
  const topDuos = useMemo(() => rankDuos(duos, 5), [duos]);
  const rivalScore = useMemo(() => rivalBlendedScorer(rivals), [rivals]);
  const rivalBreakdown = useMemo(() => rivalBreakdownScorer(rivals), [rivals]);
  const topRivals = useMemo(() => rankRivals(rivals, 5), [rivals]);

  const avgFriendshipRating = useMemo(() => {
    const eligible = duos.filter((d) => d.gamesPlayed > 0);
    if (!eligible.length) return 0;
    return Math.round(eligible.reduce((s, d) => s + duoScore(d) * 100, 0) / eligible.length);
  }, [duos, duoScore]);

  const avgRivalryScore = useMemo(() => {
    const eligible = rivals.filter((r) => r.meetings > 0);
    if (!eligible.length) return 0;
    return Math.round(eligible.reduce((s, r) => s + rivalScore(r) * 100, 0) / eligible.length);
  }, [rivals, rivalScore]);

  if (players.length === 0 || (duos.length === 0 && rivals.length === 0)) {
    return <EmptyState message="Not enough head-to-head data yet." />;
  }

  const activeDuo = active?.type === 'partner' ? findDuo(duos, active.a, active.b) : undefined;
  const activeRival = active?.type === 'opponent' ? findRival(rivals, active.a, active.b) : undefined;

  const flipToOpponent = activeDuo && active && findRival(rivals, active.a, active.b)
    ? () => setSel({ a: active.a, b: active.b, type: 'opponent' })
    : undefined;
  const flipToPartner = activeRival && active && findDuo(duos, active.a, active.b)
    ? () => setSel({ a: active.a, b: active.b, type: 'partner' })
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {topDuos.length > 0 && (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-center justify-between">
              <span
                className="font-display font-bold text-[13px]"
                title="50% games played together² · 30% win rate² · 20% round win rate²"
              >
                Best Friends
              </span>
              <LeagueAvgCircle value={avgFriendshipRating} colorStart="white" colorEnd="var(--color-accent-green-fill)" title="50% games played together² · 30% win rate² · 20% round win rate²" />
            </div>
            <DuoHeader />
            <div>
              {topDuos.map(({ duo: d, rating }, i) => {
                const a = playersById.get(d.playerA);
                const b = playersById.get(d.playerB);
                if (!a || !b) return null;
                const on = active?.type === 'partner' && active.a === d.playerA && active.b === d.playerB;
                return (
                  <DuoRow
                    key={`${d.playerA}-${d.playerB}`}
                    rank={i + 1}
                    duo={d}
                    rating={rating}
                    breakdown={duoBreakdown(d)}
                    a={a}
                    b={b}
                    highlight={on ? 'color-mix(in srgb, var(--color-accent-green-fg) 7%, transparent)' : undefined}
                    onSelect={() => setSel({ a: d.playerA, b: d.playerB, type: 'partner' })}
                    onHover={(over) => setHover(over ? { a: d.playerA, b: d.playerB, type: 'partner' } : null)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {topRivals.length > 0 && (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-center justify-between">
              <span
                className="font-display font-bold text-[13px]"
                title="50% times faced² · 30% game outcome closeness² · 20% avg round closeness²"
              >
                Closest Rivals
              </span>
              <LeagueAvgCircle value={avgRivalryScore} colorStart="black" colorEnd="var(--color-accent-red-fg)" title="50% times faced² · 30% game outcome closeness² · 20% avg round closeness²" />
            </div>
            <RivalHeader />
            <div>
              {topRivals.map(({ rival: r, rating }) => {
                const a = playersById.get(r.playerA);
                const b = playersById.get(r.playerB);
                if (!a || !b) return null;
                const on = active?.type === 'opponent' && ((active.a === r.playerA && active.b === r.playerB) || (active.a === r.playerB && active.b === r.playerA));
                return (
                  <RivalRow
                    key={`${r.playerA}-${r.playerB}`}
                    rival={r}
                    rating={rating}
                    breakdown={rivalBreakdown(r)}
                    a={a}
                    b={b}
                    highlight={on ? 'color-mix(in srgb, var(--color-t) 7%, transparent)' : undefined}
                    onSelect={() => setSel({ a: r.playerA, b: r.playerB, type: 'opponent' })}
                    onHover={(over) => setHover(over ? { a: r.playerA, b: r.playerB, type: 'opponent' } : null)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        <H2HMatrix
          players={players}
          duos={duos}
          rivals={rivals}
          active={active}
          onHover={setHover}
          onSelect={setSel}
        />

        <div className="flex flex-col gap-3.5">
          {activeDuo && <DuoDetail duo={activeDuo} players={playersById} onFlip={flipToOpponent} friendshipRating={Math.round(duoScore(activeDuo) * 100)} ratingBreakdown={duoBreakdown(activeDuo)} />}
          {activeRival && <RivalDetail rival={activeRival} players={playersById} onFlip={flipToPartner} rivalryRating={Math.round(rivalScore(activeRival) * 100)} ratingBreakdown={rivalBreakdown(activeRival)} />}
        </div>
      </div>
    </div>
  );
}
