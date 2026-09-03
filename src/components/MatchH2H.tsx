'use client';

import Link from 'next/link';
import type { MatchDuelStat, MatchKillRow, MatchDamageEventRow } from '@/lib/queries';
import { computeMatchDuels } from '@/lib/queries';
import { KILL_WEAPON_CATEGORY_LABEL, type KillWeaponCategory } from '@/lib/parsers/weaponClasses';
import { EmptyPanel, type H2HPlayer } from './MatchupDetail';
import PlayerAvatar from './PlayerAvatar';
import { WeaponIcon } from './icons/WeaponIcon';
import { HeadshotIcon } from './icons/KillModifierIcons';

const A_COLOR = 'var(--color-t)';
const B_COLOR = 'var(--color-ct)';
const HS_COLOR = 'var(--color-accent-red-fg)';

/** A representative gun per kill-weapon category, for the weapon breakdown's category icon —
 *  there's no dedicated category icon asset, so this reuses the closest single weapon's icon
 *  (already sourced for `WeaponIcon` elsewhere). `other` has no sensible representative (its kills
 *  are world/bomb deaths, never a specific weapon) so it renders no icon, just its text label. */
const CATEGORY_ICON_WEAPON: Partial<Record<KillWeaponCategory, string>> = {
  pistol: 'deagle', smg: 'mac10', rifle: 'ak47', sniper: 'awp', shotgun: 'nova',
  melee: 'knife', utility: 'hegrenade',
};

/** A stat split as a proportional bar (à la Leetify's H2H) — the two totals overlaid on their
 *  own colored segment, sized to each one's share of the pair's combined total. Kills/headshots
 *  are always real once the card renders at all (a 0-0 split is meaningful — they genuinely never
 *  traded there), so those always draw a bar with the real numbers on it; damage instead passes
 *  `emptyMessage`, since a match parsed before `match_damage_events` existed has kills but no
 *  damage rows — rather than draw a fake even split there, that shows as an explicit
 *  "no damage data" state instead of a bar. */
function SplitBar({
  label,
  aValue,
  bValue,
  emptyMessage,
}: {
  label: string;
  aValue: number;
  bValue: number;
  emptyMessage?: string;
}) {
  const total = aValue + bValue;
  const showEmpty = emptyMessage != null && total === 0;
  const aPct = total > 0 ? (aValue / total) * 100 : 50;
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="text-center tracked text-[8px] text-[var(--color-text-secondary)]">{label}</span>
      {showEmpty ? (
        <div className="flex h-6 items-center justify-center bg-[var(--color-bg-secondary)]">
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{emptyMessage}</span>
        </div>
      ) : (
        <div className="flex h-6 overflow-hidden">
          <div className="flex items-center justify-center" style={{ width: `${aPct}%`, background: A_COLOR }}>
            <span className="display-numeral text-[13px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{aValue}</span>
          </div>
          <div className="flex items-center justify-center flex-1" style={{ background: B_COLOR }}>
            <span className="display-numeral text-[13px] font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{bValue}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const PIP_W = 22;
const PIP_H = 20;
const PIP_NOTCH = 6;
// Inset so a headshot's stroke isn't clipped by the SVG viewport at the polygon's own edge.
const PIP_STROKE_INSET = 1.5;

/** One kill, as a numbered arrow-shaped "pip" (à la Leetify's H2H) — the fill color is always the
 *  side that got the kill (never color-only for headshot, so a colorblind reader isn't relying on
 *  hue alone); a headshot instead gets a red ring around the pip (not a solid red fill) plus the
 *  usual headshot badge underneath — two independent, non-color cues. Points toward the other
 *  player (`direction`) so the two sides' pip rows read as arrows meeting in the middle, rather
 *  than plain squares. */
function KillPip({
  index,
  headshot,
  color,
  direction,
}: {
  index: number;
  headshot: boolean;
  color: string;
  direction: 'right' | 'left';
}) {
  const m = PIP_STROKE_INSET;
  const points = direction === 'right'
    ? `${m},${m} ${PIP_W - PIP_NOTCH},${m} ${PIP_W - m},${PIP_H / 2} ${PIP_W - PIP_NOTCH},${PIP_H - m} ${m},${PIP_H - m}`
    : `${PIP_W - m},${m} ${PIP_NOTCH},${m} ${m},${PIP_H / 2} ${PIP_NOTCH},${PIP_H - m} ${PIP_W - m},${PIP_H - m}`;
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <div className="relative" style={{ width: PIP_W, height: PIP_H }}>
        <svg width={PIP_W} height={PIP_H} viewBox={`0 0 ${PIP_W} ${PIP_H}`}>
          <polygon points={points} fill={color} stroke={headshot ? HS_COLOR : 'none'} strokeWidth={headshot ? 2 : 0} strokeLinejoin="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-white">{index}</span>
      </div>
      <div className="h-2.5 flex items-center justify-center">
        {headshot && <HeadshotIcon size={10} style={{ color: HS_COLOR }} />}
      </div>
    </div>
  );
}

/** One weapon category's kill split — a category icon/label, then each side's kills as a strip of
 *  numbered pips (only the sides that actually landed a kill in this category get a strip). */
function WeaponCategoryBlock({ category, aKills, bKills }: MatchDuelStat['weaponBreakdown'][number]) {
  const iconWeapon = CATEGORY_ICON_WEAPON[category];
  return (
    <div className="py-2 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-center justify-center gap-1.5 mb-1.5">
        {iconWeapon && <WeaponIcon weapon={iconWeapon} size={14} className="text-[var(--color-text-secondary)]" />}
        <span className="tracked text-[9px] text-[var(--color-text-secondary)]">{KILL_WEAPON_CATEGORY_LABEL[category]}</span>
      </div>
      {aKills.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center mb-1">
          {aKills.map((headshot, i) => <KillPip key={i} index={i + 1} headshot={headshot} color={A_COLOR} direction="right" />)}
        </div>
      )}
      {bKills.length > 0 && (
        // row-reverse so kill #1 sits on the right and the sequence reads right-to-left,
        // matching the direction these pips point (mirrors the aKills row above).
        <div className="flex flex-row-reverse flex-wrap gap-1 justify-center">
          {bKills.map((headshot, i) => <KillPip key={i} index={i + 1} headshot={headshot} color={B_COLOR} direction="left" />)}
        </div>
      )}
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

        <SplitBar label="Kills" aValue={duel.aKills} bValue={duel.bKills} />
        <SplitBar label="Headshots" aValue={duel.aHeadshots} bValue={duel.bHeadshots} />
        <SplitBar label="Damage" aValue={duel.aDamage} bValue={duel.bDamage} emptyMessage="No damage data" />

        {duel.weaponBreakdown.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--color-border-primary)]">
            <div className="text-center tracked text-[8px] text-[var(--color-text-secondary)] mb-1">Weapon breakdown</div>
            {duel.weaponBreakdown.map((split) => (
              <WeaponCategoryBlock key={split.category} {...split} />
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
