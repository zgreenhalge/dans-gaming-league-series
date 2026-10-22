import type { LeaderboardRowWithId } from '@/lib/types';
import Th from './Th';
import { StatTable, Tr, Td, NameTd } from './StatTable';
import { PlayerLink } from './PlayerLink';
import { playerHref } from '@/lib/util';
import { PlayerName } from './PlayerName';
import EmptyState from './EmptyState';

import { StatusPill } from './StatusPill';
import { PanelHeader, PanelLink } from './PanelHeader';

/** A player's recent results, newest first, as colored `W` / `L` letters — the standings Form column. */
export function FormCell({ results }: { results: boolean[] }) {
  if (results.length === 0) return <span className="text-[var(--color-text-secondary)]">—</span>;
  return (
    <span
      className="tracking-[0.18em]"
      aria-label={`Last ${results.length}: ${results.map((w) => (w ? 'win' : 'loss')).join(', ')}`}
    >
      {results.map((won, i) => (
        <span key={i} style={{ color: won ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)' }}>
          {won ? 'W' : 'L'}
        </span>
      ))}
    </span>
  );
}

/**
 * The home page's standings: one season's leaderboard (already in `canonicalSort()` order) as a
 * linked title, a Live / Final pill, a "View all" link to the season and a table whose rows open
 * the player. `live` picks the pill; `gauntletHref` adds a "Gauntlet live" pill linking to the
 * season's running gauntlet. `form` maps a player id to their last results (`getSeasonForm()`).
 */
export function HomeStandingsPanel({
  title,
  seasonHref,
  live,
  gauntletHref,
  rows,
  form,
  currentPlayerId,
}: {
  title: string;
  seasonHref: string;
  live: boolean;
  gauntletHref?: string;
  rows: LeaderboardRowWithId[];
  form: Map<number, boolean[]>;
  currentPlayerId: number | null;
}) {
  const dash = (played: boolean, v: string) =>
    played ? v : <span className="text-[var(--color-text-secondary)]">—</span>;

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <PanelHeader
        title={title}
        titleHref={seasonHref}
        align="center"
        right={<PanelLink href={seasonHref}>View all →</PanelLink>}
      >
        <StatusPill variant={live ? 'live' : 'neutral'}>{live ? 'Live' : 'Final'}</StatusPill>
        {gauntletHref && (
          <StatusPill variant="amber" href={gauntletHref}>
            Gauntlet live
          </StatusPill>
        )}
      </PanelHeader>
      {rows.length === 0 ? (
        <EmptyState message="No standings yet." className="px-6 py-4" />
      ) : (
        <StatTable bare>
          <thead>
            <tr>
              <Th className="w-6" align="left">#</Th>
              <Th align="left">Player</Th>
              <Th align="right">W-L</Th>
              <Th align="right">RWR%</Th>
              <Th align="right">ADR</Th>
              <Th align="right">Form</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const played = p.total_rounds_played > 0;
              const href = playerHref(p.player_id);
              return (
                <Tr key={p.player_id} href={href}>
                  <Td align="left" muted>{i + 1}</Td>
                  <NameTd>
                    <PlayerLink playerId={p.player_id} className="flex items-center w-full h-full">
                      <PlayerName name={p.player_name} isMe={currentPlayerId !== null && p.player_id === currentPlayerId} />
                    </PlayerLink>
                  </NameTd>
                  <Td muted>{dash(played, `${p.matches_won}-${p.matches_lost}`)}</Td>
                  <Td>{dash(played, `${p.rwr_percentage.toFixed(1)}%`)}</Td>
                  <Td bold>{dash(played, p.overall_adr.toFixed(2))}</Td>
                  <Td>
                    <FormCell results={form.get(p.player_id) ?? []} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </StatTable>
      )}
    </div>
  );
}
