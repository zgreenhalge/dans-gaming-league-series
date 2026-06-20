'use client';

import { useMemo, useState } from 'react';
import H2HMatrix, { type H2HPair } from './H2HMatrix';
import { DuoDetail, RivalDetail } from './H2HDetail';
import { winRatePct } from '@/lib/util';
import type { H2HData } from '@/lib/queries';
import { duoBlendedScorer, rivalBlendedScorer, duoBreakdownScorer, rivalBreakdownScorer } from '@/lib/queries';
import PlayerAvatar from './PlayerAvatar';
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
 * career statistics page and per-season hubs (regular season and gauntlet). */
export default function H2HSection({ data, initialPair }: { data: H2HData; initialPair?: H2HPair | null }) {
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

  const [sel, setSel] = useState<H2HPair | null>(initialPair ?? defaultPair);
  const [hover, setHover] = useState<H2HPair | null>(null);
  const active = hover ?? sel ?? defaultPair;

  // See "Blended score" in docs/glossary.md. Scorer factories normalise against the full set
  // so the top-5 ranking and matrix gradient stay derived from the same formula.
  const duoScore = useMemo(() => duoBlendedScorer(duos), [duos]);
  const duoBreakdown = useMemo(() => duoBreakdownScorer(duos), [duos]);
  const topDuos = useMemo(() => {
    const eligible = duos.filter((d) => d.gamesPlayed > 0);
    return [...eligible].sort((x, y) => duoScore(y) - duoScore(x)).slice(0, 5);
  }, [duos, duoScore]);
  const rivalScore = useMemo(() => rivalBlendedScorer(rivals), [rivals]);
  const rivalBreakdown = useMemo(() => rivalBreakdownScorer(rivals), [rivals]);
  const topRivals = useMemo(() => {
    const eligible = rivals.filter((r) => r.meetings > 0);
    return [...eligible].sort((x, y) => rivalScore(y) - rivalScore(x)).slice(0, 5);
  }, [rivals, rivalScore]);

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
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        Not enough head-to-head data yet.
      </div>
    );
  }

  const findDuo = (a: number, b: number) =>
    duos.find((d) => (d.playerA === a && d.playerB === b) || (d.playerA === b && d.playerB === a));
  const findRival = (a: number, b: number) =>
    rivals.find((r) => (r.playerA === a && r.playerB === b) || (r.playerA === b && r.playerB === a));

  const activeDuo = active?.type === 'partner' ? findDuo(active.a, active.b) : undefined;
  const activeRival = active?.type === 'opponent' ? findRival(active.a, active.b) : undefined;

  const flipToOpponent = activeDuo && active && findRival(active.a, active.b)
    ? () => setSel({ a: active.a, b: active.b, type: 'opponent' })
    : undefined;
  const flipToPartner = activeRival && active && findDuo(active.a, active.b)
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
            <div className="flex items-center px-3.5 pt-2">
              <span className="flex-1" />
              <div className="grid grid-cols-[28px_34px_44px_88px] gap-x-2 shrink-0">
                <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center">Rating</span>
                <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-right">Games</span>
                <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-right">W-L</span>
                <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-right">Rounds W-L</span>
              </div>
            </div>
            <div>
              {topDuos.map((d, i) => {
                const a = playersById.get(d.playerA);
                const b = playersById.get(d.playerB);
                if (!a || !b) return null;
                const on = active?.type === 'partner' && active.a === d.playerA && active.b === d.playerB;
                const wr = winRatePct(d.wins, d.gamesPlayed);
                const rwr = winRatePct(d.roundsWon, d.roundsPlayed);
                return (
                  <div
                    key={`${d.playerA}-${d.playerB}`}
                    className="lift-row flex items-center gap-2.5 px-3.5 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer"
                    style={on ? { background: 'color-mix(in srgb, var(--color-accent-green-fg) 7%, transparent)' } : undefined}
                    onClick={() => setSel({ a: d.playerA, b: d.playerB, type: 'partner' })}
                    onMouseEnter={() => setHover({ a: d.playerA, b: d.playerB, type: 'partner' })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className="display-numeral text-[12px] w-3.5 text-[var(--color-text-secondary)]">{i + 1}</span>
                    <div className="flex">
                      <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />
                      <div className="-ml-1.5"><PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" /></div>
                    </div>
                    <span className="font-display font-semibold text-[11px] flex-1 truncate">{a.name} &amp; {b.name}</span>
                    <div className="grid grid-cols-[28px_34px_44px_88px] gap-x-2 shrink-0 items-center">
                      <div className="flex justify-center">
                        <RatingCircle value={Math.round(duoScore(d) * 100)} colorStart="white" colorEnd="var(--color-accent-green-fill)" size="xs" title={duoBreakdown(d)} />
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="display-numeral text-[13px] text-right">{d.gamesPlayed}</span>
                        <span className="font-mono text-[8px] text-right">&nbsp;</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="display-numeral text-[13px] text-right">{d.wins}–{d.gamesPlayed - d.wins}</span>
                        <span className="font-mono text-[8px] text-[var(--color-text-secondary)] text-right">{wr}%</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="display-numeral text-[13px] inline-block w-[58px] text-right">{d.roundsWon}–{d.roundsPlayed - d.roundsWon}</span>
                        <span className="font-mono text-[8px] text-[var(--color-text-secondary)] inline-block w-[58px] text-right">{rwr}%</span>
                      </div>
                    </div>
                  </div>
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
            <div className="grid grid-cols-[28px_1fr_38px_38px_38px_38px_38px_1fr_28px] items-center gap-2 px-3.5 pt-2">
              <span />
              <span />
              <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center">Rounds</span>
              <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center">Won</span>
              <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)]">Rating</span>
              <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center">Won</span>
              <span className="tracked text-[8px] text-[var(--color-text-secondary)] text-center">Rounds</span>
              <span />
              <span />
            </div>
            <div>
              {topRivals.map((r) => {
                const a = playersById.get(r.playerA);
                const b = playersById.get(r.playerB);
                if (!a || !b) return null;
                const on = active?.type === 'opponent' && ((active.a === r.playerA && active.b === r.playerB) || (active.a === r.playerB && active.b === r.playerA));
                const aWinsHigher = r.aWins > r.bWins;
                const bWinsHigher = r.bWins > r.aWins;
                const aRoundsHigher = r.aStats.roundsWon > r.bStats.roundsWon;
                const bRoundsHigher = r.bStats.roundsWon > r.aStats.roundsWon;
                const dim = 'text-[var(--color-text-secondary)]';
                const accent = 'text-[var(--color-site-accent)]';
                return (
                  <div
                    key={`${r.playerA}-${r.playerB}`}
                    className="lift-row grid grid-cols-[28px_1fr_38px_38px_38px_38px_38px_1fr_28px] items-center gap-2 px-3.5 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer"
                    style={on ? { background: 'color-mix(in srgb, var(--color-t) 7%, transparent)' } : undefined}
                    onClick={() => setSel({ a: r.playerA, b: r.playerB, type: 'opponent' })}
                    onMouseEnter={() => setHover({ a: r.playerA, b: r.playerB, type: 'opponent' })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />
                    <span className="font-display font-semibold text-[11px] truncate">{a.name}</span>
                    <span className={`display-numeral text-[12px] text-center${aRoundsHigher ? ` ${accent}` : !bRoundsHigher ? '' : ` ${dim}`}`}>{r.aStats.roundsWon}</span>
                    <span className={`display-numeral text-[12px] text-center${aWinsHigher ? ` ${accent}` : !bWinsHigher ? '' : ` ${dim}`}`}>{r.aWins}</span>
                    <div className="flex items-center justify-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)] self-stretch -my-2">
                      <RatingCircle value={Math.round(rivalScore(r) * 100)} colorStart="black" colorEnd="var(--color-accent-red-fg)" size="xs" title={rivalBreakdown(r)} />
                    </div>
                    <span className={`display-numeral text-[12px] text-center${bWinsHigher ? ` ${accent}` : !aWinsHigher ? '' : ` ${dim}`}`}>{r.bWins}</span>
                    <span className={`display-numeral text-[12px] text-center${bRoundsHigher ? ` ${accent}` : !aRoundsHigher ? '' : ` ${dim}`}`}>{r.bStats.roundsWon}</span>
                    <span className="font-display font-semibold text-[11px] text-right truncate">{b.name}</span>
                    <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" />
                  </div>
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
