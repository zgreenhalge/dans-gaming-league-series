import { StatTable, Tr, Td, PlayerCell } from './StatTable';
import Th from './Th';
import EmptyState from './EmptyState';
import { MatchCard } from './MatchCard';
import { matchCardRight } from '@/lib/match-card';
import { playerHref, scrimMatchHref } from '@/lib/crumbs';
import { formatStat } from '@/lib/util';
import { isScrimMatchEditable, scrimMatchNeedsServer, scrimTeamLabel } from '@/lib/scrim-matches';
import type { ScrimLeaderboardRow, ScrimMatch } from '@/lib/queries';

/** A scrim night's standings: every player who played a scored match, ranked Wins → RWR% → ADR
 *  (`buildScrimNightLeaderboard()`). `condensed` drops the K/D and Kills columns, for the lobby tab
 *  where it sits under the lobby. */
export function ScrimNightLeaderboard({ rows, condensed = false }: { rows: ScrimLeaderboardRow[]; condensed?: boolean }) {
  if (rows.length === 0) return <EmptyState message="No scored matches yet." className="py-2" />;
  return (
    <StatTable>
      <thead>
        <tr>
          <Th sticky>Player</Th>
          <Th align="right">W-L</Th>
          <Th align="right" title="Round Win Rate">RWR%</Th>
          <Th align="right" title="Average Damage per Round">ADR</Th>
          {!condensed && <Th align="right">K/D</Th>}
          {!condensed && <Th align="right">Kills</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.player_id} href={playerHref(r.player_id)}>
            <PlayerCell id={r.player_id} name={r.player_name} avatarUrl={r.steam_avatar_url} />
            <Td>{r.wins}-{r.losses}</Td>
            <Td>{formatStat(r.rwr, 1)}</Td>
            <Td>{formatStat(r.adr, 2)}</Td>
            {!condensed && <Td>{formatStat(r.kd, 2)}</Td>}
            {!condensed && <Td>{r.kills}</Td>}
          </Tr>
        ))}
      </tbody>
    </StatTable>
  );
}

/** A scrim night's matches, newest first, as the same `MatchCard` rows every match list uses: the
 *  match on the server now as Live, then those played, with those whose game is over but have no
 *  score yet (demo parsing) shown as Pending. A match still in the lobby, not started, is left out. */
export function ScrimNightMatchList({
  matches,
  names,
  currentPlayerId,
}: {
  matches: ScrimMatch[];
  names: Record<number, string>;
  currentPlayerId: number | null;
}) {
  const live = matches.filter((m) => scrimMatchNeedsServer(m) && !isScrimMatchEditable(m));
  const shown = [...live, ...matches.filter((m) => !scrimMatchNeedsServer(m)).reverse()];
  if (shown.length === 0) return <EmptyState message="No matches played yet." className="py-2" />;
  const statsFor = (m: ScrimMatch, faction: 'SHIRTS' | 'SKINS') =>
    m.players.filter((p) => p.faction === faction).map((p) => ({ ...p, player_name: names[p.player_id] ?? `#${p.player_id}` }));
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {shown.map((m) => {
        // The match on the server now has no stats yet, so its lineups show by name.
        const live = scrimMatchNeedsServer(m);
        return (
          <MatchCard
            key={m.id}
            href={scrimMatchHref(m.id)}
            map={m.map}
            label={{ type: 'match', matchNumber: m.match_number, isFeatureMatch: false }}
            right={live ? { type: 'live' } : matchCardRight(m.final_score, null, { type: 'pending' })}
            shirtsStats={live ? undefined : statsFor(m, 'SHIRTS')}
            skinsStats={live ? undefined : statsFor(m, 'SKINS')}
            shirtsFallback={live ? scrimTeamLabel(m.shirts, names) : undefined}
            skinsFallback={live ? scrimTeamLabel(m.skins, names) : undefined}
            currentPlayerId={currentPlayerId}
          />
        );
      })}
    </div>
  );
}
