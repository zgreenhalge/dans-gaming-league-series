import { Fragment } from 'react';
import { StatTable, Tr, Td, PlayerCell } from './StatTable';
import Th from './Th';
import EmptyState from './EmptyState';
import { MatchCard } from './MatchCard';
import { ScrimPendingMatchActions } from './ScrimPendingMatchActions';
import { matchCardRight } from '@/lib/match-card';
import { playerHref, scrimMatchHref } from '@/lib/crumbs';
import { formatStat } from '@/lib/util';
import { scrimTeamLabel } from '@/lib/scrim-matches';
import type { ScrimRunningOrderEntry } from '@/lib/scrim-night-page';
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
            <Td>{formatStat(r.rwr, 1)}</Td>
            <Td>{formatStat(r.adr, 2)}</Td>
            <Td>{formatStat(r.kd, 2)}</Td>
            <Td>{r.kills}</Td>
          </Tr>
        ))}
      </tbody>
    </StatTable>
  );
}

/** A scrim night's running order (`buildScrimNightPageModel()`'s `runningOrder`), as the same
 *  `MatchCard` rows every match list uses: the matches whose game is over, in play order — a played one
 *  with its score and each player's K/D and ADR, one with no score yet (the demo is parsing) as Pending
 *  — then the match on the server as Live, then those still to start as Up next, by lineup. A Pending
 *  row with `resolve` has the admin's `ScrimPendingMatchActions` under it. */
export function ScrimNightMatchList({
  entries,
  names,
  currentPlayerId,
}: {
  entries: ScrimRunningOrderEntry[];
  names: Record<number, string>;
  currentPlayerId: number | null;
}) {
  const statsFor = (m: ScrimMatch, faction: 'SHIRTS' | 'SKINS') =>
    m.players.filter((p) => p.faction === faction).map((p) => ({ ...p, player_name: names[p.player_id] ?? `#${p.player_id}` }));
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {entries.map(({ match: m, status, resolve }) => {
        // A match that hasn't finished has no stats yet, so its lineups show by name.
        const unfinished = status === 'live' || status === 'next';
        return (
          <Fragment key={m.id}>
            <MatchCard
              href={scrimMatchHref(m.id)}
              map={m.map}
              label={{ type: 'match', matchNumber: m.match_number, isFeatureMatch: false }}
              right={unfinished ? { type: status } : matchCardRight(m.final_score, null, { type: 'pending' })}
              shirtsStats={unfinished ? undefined : statsFor(m, 'SHIRTS')}
              skinsStats={unfinished ? undefined : statsFor(m, 'SKINS')}
              shirtsFallback={unfinished ? scrimTeamLabel(m.shirts, names) : undefined}
              skinsFallback={unfinished ? scrimTeamLabel(m.skins, names) : undefined}
              currentPlayerId={currentPlayerId}
            />
            {resolve && <ScrimPendingMatchActions match={m} />}
          </Fragment>
        );
      })}
    </div>
  );
}
