'use client';

import Link from 'next/link';
import type { MatchDuelStat, MatchKillRow, MatchDamageEventRow } from '@/lib/queries';
import { computeMatchDuels } from '@/lib/queries';
import { KILL_WEAPON_CATEGORY_LABEL } from '@/lib/parsers/weaponClasses';
import { EmptyPanel, type H2HPlayer } from './MatchupDetail';
import PlayerAvatar from './PlayerAvatar';

const A_COLOR = 'var(--color-t)';
const B_COLOR = 'var(--color-ct)';

/** A two-column stat row — `aValue` under the left (shirts) player, `bValue` under the right
 *  (skins) one, with the stat's label centered between them. */
function StatRow({ label, aValue, bValue }: { label: string; aValue: React.ReactNode; bValue: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="flex-1 text-right font-mono tnum text-[15px] font-bold" style={{ color: A_COLOR }}>{aValue}</span>
      <span className="w-[64px] shrink-0 text-center tracked text-[8px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="flex-1 font-mono tnum text-[15px] font-bold" style={{ color: B_COLOR }}>{bValue}</span>
    </div>
  );
}

/** Damage split as a proportional bar (à la Leetify's H2H) — the two totals overlaid on their
 *  own colored segment, sized to how much of the pair's combined damage each one dealt. A match
 *  parsed before `match_damage_events` existed has kills but no damage rows — rather than draw a
 *  fake even split, that shows as an explicit "no damage data" state. */
function DamageBar({ aDamage, bDamage }: { aDamage: number; bDamage: number }) {
  const total = aDamage + bDamage;
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="text-center tracked text-[8px] text-[var(--color-text-secondary)]">Damage</span>
      {total === 0 ? (
        <div className="flex h-6 items-center justify-center bg-[var(--color-bg-secondary)]">
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">No damage data</span>
        </div>
      ) : (
        <div className="flex h-6 overflow-hidden">
          <div className="flex items-center justify-center" style={{ width: `${(aDamage / total) * 100}%`, background: A_COLOR }}>
            {aDamage > 0 && <span className="display-numeral text-[13px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{aDamage}</span>}
          </div>
          <div className="flex items-center justify-center flex-1" style={{ background: B_COLOR }}>
            {bDamage > 0 && <span className="display-numeral text-[13px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{bDamage}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** One weapon category's kill split, e.g. "Rifles  2 – 0". */
function WeaponBreakdownRow({ category, aKills, bKills }: MatchDuelStat['weaponBreakdown'][number]) {
  return (
    <div className="flex items-center gap-2 py-1 border-t border-[var(--color-border-tertiary)]">
      <span className="flex-1 text-right font-mono tnum text-[11px]" style={{ color: aKills > 0 ? A_COLOR : 'var(--color-text-secondary)' }}>{aKills}</span>
      <span className="w-[64px] shrink-0 text-center font-mono text-[10px] text-[var(--color-text-secondary)] truncate">{KILL_WEAPON_CATEGORY_LABEL[category]}</span>
      <span className="flex-1 font-mono tnum text-[11px]" style={{ color: bKills > 0 ? B_COLOR : 'var(--color-text-secondary)' }}>{bKills}</span>
    </div>
  );
}

/** One shirts-vs-skins pair's duel record for this match — kills, damage, headshots, and a
 *  weapon-class breakdown, read straight off the killfeed and damage log (`computeMatchDuels()`).
 *  Styled after Leetify's head-to-head: a literal kill/damage exchange between two specific
 *  players in one match, not a season-aggregate rivalry score. */
function DuelCard({ duel, players }: { duel: MatchDuelStat; players: Map<number, H2HPlayer> }) {
  const a = players.get(duel.aId);
  const b = players.get(duel.bId);
  if (!a || !b) return null;

  const totalKills = duel.aKills + duel.bKills;
  if (totalKills === 0 && duel.aDamage === 0 && duel.bDamage === 0) {
    return <EmptyPanel label={`${a.name} & ${b.name} — no direct kills recorded`} />;
  }

  const aHsPct = duel.aKills > 0 ? Math.round((duel.aHeadshots / duel.aKills) * 100) : 0;
  const bHsPct = duel.bKills > 0 ? Math.round((duel.bHeadshots / duel.bKills) * 100) : 0;
  const nameStyle = (color: string): React.CSSProperties => ({ color, WebkitTextStroke: '1px black', paintOrder: 'stroke fill' });

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href={`/players/${a.id}`} className="flex-1 min-w-0 flex items-center gap-2">
            <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />
            <span className="font-display font-bold text-[13px] truncate" style={nameStyle(A_COLOR)}>{a.name}</span>
          </Link>
          <Link href={`/players/${b.id}`} className="flex-1 min-w-0 flex items-center gap-2 justify-end text-right">
            <span className="font-display font-bold text-[13px] truncate" style={nameStyle(B_COLOR)}>{b.name}</span>
            <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" />
          </Link>
        </div>

        <StatRow label="Kills" aValue={duel.aKills} bValue={duel.bKills} />
        <StatRow label="HS%" aValue={`${aHsPct}%`} bValue={`${bHsPct}%`} />
        <DamageBar aDamage={duel.aDamage} bDamage={duel.bDamage} />

        {duel.weaponBreakdown.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--color-border-primary)]">
            <div className="text-center tracked text-[8px] text-[var(--color-text-secondary)] mb-1">Weapon breakdown</div>
            {duel.weaponBreakdown.map((row) => (
              <WeaponBreakdownRow key={row.category} {...row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * This match's own 4 shirts-vs-skins duels, computed from the parsed demo's killfeed and damage
 * log — how many times each pair actually killed each other, with what weapons, and how much
 * damage each dealt, this match only. Inspired by Leetify's head-to-head: a real exchange
 * between two specific players, not a career rivalry score.
 */
export default function MatchH2H({
  shirtIds,
  skinIds,
  matchKills,
  matchDamageEvents,
  players,
}: {
  shirtIds: [number, number];
  skinIds: [number, number];
  matchKills: MatchKillRow[];
  matchDamageEvents: MatchDamageEventRow[];
  players: Map<number, H2HPlayer>;
}) {
  const duels = computeMatchDuels(matchKills, matchDamageEvents, shirtIds, skinIds);

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
