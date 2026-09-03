'use client';

import Link from 'next/link';
import type { MatchDuelStat, MatchKillRow } from '@/lib/queries';
import { computeMatchDuels } from '@/lib/queries';
import { EmptyPanel, type H2HPlayer } from './MatchupDetail';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

/** One shirts-vs-skins pair's duel record for this match — the number of times each one killed
 *  the other, read straight off the killfeed (`computeMatchDuels()`). Styled after Leetify's
 *  head-to-head: a literal kill exchange between two specific players in one match, not a
 *  season-aggregate rivalry score. */
function DuelCard({ duel, players }: { duel: MatchDuelStat; players: Map<number, H2HPlayer> }) {
  const a = players.get(duel.aId);
  const b = players.get(duel.bId);
  if (!a || !b) return null;

  const total = duel.aKills + duel.bKills;
  if (total === 0) {
    return <EmptyPanel label={`${a.name} & ${b.name} — no direct kills recorded`} />;
  }

  const circleValue = Math.round((duel.aKills / total) * 100);
  const aHsPct = duel.aKills > 0 ? Math.round((duel.aHeadshots / duel.aKills) * 100) : 0;
  const bHsPct = duel.bKills > 0 ? Math.round((duel.bHeadshots / duel.bKills) * 100) : 0;
  const nameStyle = (color: string): React.CSSProperties => ({ color, WebkitTextStroke: '1px black', paintOrder: 'stroke fill' });

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-3 mb-2">
          <Link href={`/players/${a.id}`} className="flex-1 min-w-0 flex items-center gap-2">
            <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />
            <span className="font-display font-bold text-[13px] truncate" style={nameStyle('var(--color-t)')}>{a.name}</span>
          </Link>
          <RatingCircle value={circleValue} colorStart="black" colorEnd="var(--color-accent-red-fg)" size="lg" title="% of the kills between them landed by this player, this match" />
          <Link href={`/players/${b.id}`} className="flex-1 min-w-0 flex items-center gap-2 justify-end text-right">
            <span className="font-display font-bold text-[13px] truncate" style={nameStyle('var(--color-ct)')}>{b.name}</span>
            <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" />
          </Link>
        </div>

        <div className="flex h-8 overflow-hidden mb-3">
          <div className="flex items-center justify-center" style={{ width: `${(duel.aKills / total) * 100}%`, background: 'var(--color-t)' }}>
            {duel.aKills > 0 && (
              <span className="display-numeral text-[20px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                {duel.aKills}
              </span>
            )}
          </div>
          <div className="flex items-center justify-center flex-1" style={{ background: 'var(--color-ct)' }}>
            {duel.bKills > 0 && (
              <span className="display-numeral text-[20px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                {duel.bKills}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 py-1 border-t border-[var(--color-border-primary)] pt-2">
          <span className="flex-1 tracked text-[8px] text-[var(--color-text-secondary)]">Kills</span>
          <span className="w-[32px] text-right tracked text-[8px] text-[var(--color-text-secondary)]">HS%</span>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="flex-1 font-mono text-[11px]" style={{ color: 'var(--color-t)' }}>{duel.aKills}</span>
          <span className="w-[32px] text-right font-mono tnum text-[11px]">{aHsPct}%</span>
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="flex-1 font-mono text-[11px]" style={{ color: 'var(--color-ct)' }}>{duel.bKills}</span>
          <span className="w-[32px] text-right font-mono tnum text-[11px]">{bHsPct}%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * This match's own 4 shirts-vs-skins duels, computed from the parsed demo's killfeed — how many
 * times each pair actually killed each other, this match only. Inspired by Leetify's
 * head-to-head: a real kill exchange between two specific players, not a career rivalry score.
 */
export default function MatchH2H({
  shirtIds,
  skinIds,
  matchKills,
  players,
}: {
  shirtIds: [number, number];
  skinIds: [number, number];
  matchKills: MatchKillRow[];
  players: Map<number, H2HPlayer>;
}) {
  const duels = computeMatchDuels(matchKills, shirtIds, skinIds);

  return (
    <div className="mt-6">
      <div className="tracked text-[10px] mb-4" style={{ letterSpacing: '0.2em' }}>
        <span className="text-[var(--color-t)]">Match H2H</span>
        <span className="text-[var(--color-text-secondary)] mx-2">—</span>
        <span className="text-[var(--color-t)]">Duels</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {duels.map((duel) => (
          <DuelCard key={`${duel.aId}-${duel.bId}`} duel={duel} players={players} />
        ))}
      </div>
    </div>
  );
}
