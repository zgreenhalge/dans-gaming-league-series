'use client';

import { aggregateWeaponKillStats, favoriteWeapon, type MatchKillRow } from '@/lib/queries/kills';
import Th from './Th';

/**
 * Per-player kills-by-weapon breakdown for one match (#452) — kills/HS%/deaths per individual
 * weapon, from `match_kills`. Grouped by player rather than one flat table so each player's
 * favorite weapon for the match is easy to spot.
 */
export default function MatchWeaponsTable({
  kills,
  players,
}: {
  kills: MatchKillRow[];
  players: { player_id: number; player_name: string; faction: 'SHIRTS' | 'SKINS' }[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Weapons</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {players.map((p) => {
          const stats = aggregateWeaponKillStats(kills, p.player_id);
          if (stats.length === 0) return null;
          const favorite = favoriteWeapon(stats);
          return (
            <div key={p.player_id} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-x-auto">
              <div className="flex items-baseline justify-between px-4 py-2 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)]">
                <span className="tracked text-[11px] font-semibold">{p.player_name}</span>
                {favorite && favorite.kills > 0 && (
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    Favorite: <span className="text-[var(--color-text-primary)] font-semibold">{favorite.weapon}</span>
                  </span>
                )}
              </div>
              <table className="w-full min-w-max border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[var(--color-bg-secondary)]">
                    <Th align="left">Weapon</Th>
                    <Th align="right">Kills</Th>
                    <Th align="right">HS%</Th>
                    <Th align="right">Deaths</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.filter((s) => s.kills > 0 || s.deaths > 0).map((s) => (
                    <tr key={s.weapon} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                      <td className="pl-4 pr-3 py-2 tracked text-[11px] font-semibold">{s.weapon}</td>
                      <td className="px-3 py-2 text-right font-mono tnum text-[var(--color-text-primary)]">{s.kills}</td>
                      <td className="px-3 py-2 text-right font-mono tnum text-[var(--color-text-secondary)]">
                        {s.kills > 0 ? `${((s.headshotKills / s.kills) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 pr-4 py-2 text-right font-mono tnum text-[var(--color-text-secondary)]">{s.deaths}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
