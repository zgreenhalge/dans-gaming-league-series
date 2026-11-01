import { StatTable, Tr, Td, PlayerCell } from './StatTable';
import Th from './Th';
import EmptyState from './EmptyState';
import { MatchCard, matchCardRight } from './MatchCard';
import { playerHref, scrimMatchHref } from '@/lib/crumbs';
import { isPlayedScore } from '@/lib/util';
import type { ScrimLeaderboardRow, ScrimMatch } from '@/lib/queries';

/** A scrim night's standings: every player who played a scored match, ranked Wins → RWR% → ADR
 *  (`buildScrimNightLeaderboard()`). */
export function ScrimNightLeaderboard({ rows }: { rows: ScrimLeaderboardRow[] }) {
  if (rows.length === 0) return <EmptyState message="No scored matches yet." className="py-2" />;
  return (
    <StatTable>
      <thead>
        <tr>
          <Th sticky>Player</Th>
          <Th align="right">W-L</Th>
          <Th align="right" title="Round Win Rate">RWR%</Th>
          <Th align="right" title="Average Damage per Round">ADR</Th>
          <Th align="right">K/D</Th>
          <Th align="right">Kills</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.player_id} href={playerHref(r.player_id)}>
            <PlayerCell id={r.player_id} name={r.player_name} avatarUrl={r.steam_avatar_url} />
            <Td>{r.wins}-{r.losses}</Td>
            <Td>{r.rwr.toFixed(1)}</Td>
            <Td>{r.adr.toFixed(2)}</Td>
            <Td>{r.kd.toFixed(2)}</Td>
            <Td>{r.kills}</Td>
          </Tr>
        ))}
      </tbody>
    </StatTable>
  );
}

/** A scrim night's scored matches, newest first, as the same `MatchCard` rows every match list uses. */
export function ScrimNightMatchList({
  matches,
  names,
  currentPlayerId,
}: {
  matches: ScrimMatch[];
  names: Record<number, string>;
  currentPlayerId: number | null;
}) {
  const played = matches.filter((m) => isPlayedScore(m.final_score)).reverse();
  if (played.length === 0) return <EmptyState message="No matches played yet." className="py-2" />;
  const statsFor = (m: ScrimMatch, faction: 'SHIRTS' | 'SKINS') =>
    m.players.filter((p) => p.faction === faction).map((p) => ({ ...p, player_name: names[p.player_id] ?? `#${p.player_id}` }));
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {played.map((m) => (
        <MatchCard
          key={m.id}
          href={scrimMatchHref(m.id)}
          map={m.map}
          label={{ type: 'match', matchNumber: m.match_number, isFeatureMatch: false }}
          right={matchCardRight(m.final_score, null, null)}
          shirtsStats={statsFor(m, 'SHIRTS')}
          skinsStats={statsFor(m, 'SKINS')}
          currentPlayerId={currentPlayerId}
        />
      ))}
    </div>
  );
}
