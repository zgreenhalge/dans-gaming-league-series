'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { GauntletRound, GauntletMatch } from '@/lib/queries';
import { isPlayedScore } from '@/lib/util';
import PlayerAvatar from '@/components/PlayerAvatar';
import { YouBadge } from '@/components/YouBadge';

const MEDAL_COLORS = { 1: '#f5c542', 2: '#a0a3ab', 3: '#c47a3a' } as const;
const tint = (rank: 1 | 2 | 3, opacity = 18) =>
  `color-mix(in srgb, ${MEDAL_COLORS[rank]} ${opacity}%, var(--color-bg-primary))`;

function computeRecords(matches: GauntletMatch[]) {
  const records = new Map<number, { player_id: number; name: string; wins: number; losses: number }>();
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    for (const p of [...m.shirts, ...m.skins]) {
      const prev = records.get(p.player_id) ?? { player_id: p.player_id, name: p.player_name, wins: 0, losses: 0 };
      p.is_win ? prev.wins++ : prev.losses++;
      records.set(p.player_id, prev);
    }
  }
  return Array.from(records.values()).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

export default function GauntletStandings({
  rounds,
  leaderboard,
}: {
  rounds: GauntletRound[];
  leaderboard: LeaderboardRowWithId[];
}) {
  const { data: session } = useSession();
  const myPlayerId = session?.user?.playerId ?? null;

  if (rounds.length === 0) return null;
  const finalRound = rounds[rounds.length - 1];
  if (!finalRound.matches.every((m) => isPlayedScore(m.final_score))) return null;

  const records = computeRecords(finalRound.matches);
  const champion = records.find((r) => r.wins === 2) ?? null;
  if (!champion) return null;

  const statsByPlayer = new Map(leaderboard.map((r) => [r.player_id, r]));
  const contenders = records.filter((r) => r.wins === 1).sort((a, b) => {
    const as = statsByPlayer.get(a.player_id);
    const bs = statsByPlayer.get(b.player_id);
    if (!as || !bs) return 0;
    return bs.rwr_percentage - as.rwr_percentage || bs.overall_adr - as.overall_adr;
  });

  const second = contenders[0] ?? null;
  const third = contenders[1] ?? null;
  const champStats = statsByPlayer.get(champion.player_id);

  return (
    <div className="overflow-hidden flex flex-col gap-1 mb-8">
      <Link
        href={`/players/${champion.player_id}`}
        className="block px-6 py-5 border-b border-[var(--color-border-tertiary)] transition-colors"
        style={{ background: tint(1), border: `4px solid ${MEDAL_COLORS[1]}` }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = tint(1, 28); }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = tint(1); }}
      >
        <div className="tracked text-[9px] mb-1.5" style={{ color: MEDAL_COLORS[1] }}>
          Champion
        </div>
        <div className="flex items-center gap-3">
          <PlayerAvatar name={champion.name} imageUrl={champStats?.steam_avatar_url ?? null} size="md" />
          <div className="font-display text-[28px] font-semibold leading-tight flex items-center gap-2" style={{ color: MEDAL_COLORS[1] }}>
            {champion.name}
            {myPlayerId !== null && champion.player_id === myPlayerId && <YouBadge />}
          </div>
        </div>
        {champStats && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex items-center gap-4">
            <span>
              <span className="font-semibold text-[var(--color-text-primary)]">{champStats.overall_adr.toFixed(1)}</span>
              <span className="ml-1">ADR</span>
            </span>
            <span>
              <span className="font-semibold text-[var(--color-text-primary)]">{champStats.rwr_percentage.toFixed(1)}%</span>
              <span className="ml-1">RWR</span>
            </span>
            <span>
              <span className="font-semibold text-[var(--color-text-primary)]">{champStats.kd_ratio.toFixed(2)}</span>
              <span className="ml-1">K/D</span>
            </span>
          </div>
        )}
      </Link>

      {(second || third) && (
        <div className="grid grid-cols-2 gap-1">
          {([second, third] as const).map((p, i) => {
            if (!p) return <div key={i} />;
            const rank = (i + 2) as 2 | 3;
            const ps = statsByPlayer.get(p.player_id);
            return (
              <Link
                key={p.player_id}
                href={`/players/${p.player_id}`}
                className="block px-5 py-4 transition-colors"
                style={{ background: tint(rank), border: `4px solid ${MEDAL_COLORS[rank]}` }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = tint(rank, 28); }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = tint(rank); }}
              >
                <div className="tracked text-[9px] mb-1" style={{ color: MEDAL_COLORS[rank] }}>
                  {i === 0 ? '2nd Place' : '3rd Place'}
                </div>
                <div className="flex items-center gap-2">
                  <PlayerAvatar name={p.name} imageUrl={ps?.steam_avatar_url ?? null} size="sm" />
                  <div className="font-display text-[18px] font-semibold leading-tight flex items-center gap-1.5" style={{ color: MEDAL_COLORS[rank] }}>
                    <span className="truncate">{p.name}</span>
                    {myPlayerId !== null && p.player_id === myPlayerId && <YouBadge />}
                  </div>
                </div>
                {ps && (
                  <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                    <span>
                      <span className="font-semibold text-[var(--color-text-primary)]">{ps.overall_adr.toFixed(1)}</span>
                      <span className="ml-1">ADR</span>
                    </span>
                    <span>
                      <span className="font-semibold text-[var(--color-text-primary)]">{ps.rwr_percentage.toFixed(1)}%</span>
                      <span className="ml-1">RWR</span>
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
