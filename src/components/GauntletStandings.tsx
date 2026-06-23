'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { GauntletRound } from '@/lib/queries';
import { canonicalGauntletRankMap } from '@/lib/util';
import PlayerAvatar from '@/components/PlayerAvatar';
import { PlayerName } from '@/components/PlayerName';

const MEDAL_COLORS = { 1: '#f5c542', 2: '#a0a3ab', 3: '#c47a3a' } as const;
const tint = (rank: 1 | 2 | 3, opacity = 18) =>
  `color-mix(in srgb, ${MEDAL_COLORS[rank]} ${opacity}%, var(--color-bg-primary))`;

export default function GauntletStandings({
  rounds,
  leaderboard,
}: {
  rounds: GauntletRound[];
  leaderboard: LeaderboardRowWithId[];
}) {
  const { data: session } = useSession();
  const myPlayerId = session?.user?.playerId ?? null;

  // Podium order comes straight from the canonical gauntlet ranking so the
  // standings and the leaderboard table can't drift. Returns an empty map
  // until the gauntlet is complete.
  const rankMap = canonicalGauntletRankMap(rounds);
  if (rankMap.size === 0) return null;

  const byRank = new Map<number, number>();
  for (const [playerId, rank] of rankMap) byRank.set(rank, playerId);

  const championId = byRank.get(1);
  if (championId == null) return null;
  const secondId = byRank.get(2) ?? null;
  const thirdId = byRank.get(3) ?? null;

  const statsByPlayer = new Map(leaderboard.map((r) => [r.player_id, r]));
  const champStats = statsByPlayer.get(championId);
  const champion = { player_id: championId, name: champStats?.player_name ?? '' };
  const second = secondId == null ? null : { player_id: secondId, name: statsByPlayer.get(secondId)?.player_name ?? '' };
  const third = thirdId == null ? null : { player_id: thirdId, name: statsByPlayer.get(thirdId)?.player_name ?? '' };

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
            <PlayerName name={champion.name} isMe={myPlayerId !== null && champion.player_id === myPlayerId} />
          </div>
        </div>
        {champStats && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex items-center gap-4">
            <span>
              <span className="font-semibold text-[var(--color-text-primary)]">{champStats.overall_adr.toFixed(2)}</span>
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
                    <span className="truncate"><PlayerName name={p.name} isMe={myPlayerId !== null && p.player_id === myPlayerId} /></span>
                  </div>
                </div>
                {ps && (
                  <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                    <span>
                      <span className="font-semibold text-[var(--color-text-primary)]">{ps.overall_adr.toFixed(2)}</span>
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
