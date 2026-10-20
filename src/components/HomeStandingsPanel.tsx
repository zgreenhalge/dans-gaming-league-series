import Link from 'next/link';
import type { LeaderboardRowWithId } from '@/lib/types';
import Th from './Th';
import { StatTable, Tr, Td, NameTd } from './StatTable';
import { PlayerName } from './PlayerName';
import EmptyState from './EmptyState';

const PILL_CLS = 'inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold border';

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
      <div className="px-6 py-4 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={seasonHref}
            className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-site-accent)] transition-colors"
          >
            {title}
          </Link>
          {live ? (
            <span className={`${PILL_CLS} text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]`}>
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
              Live
            </span>
          ) : (
            <span className={`${PILL_CLS} text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]`}>
              Final
            </span>
          )}
          {gauntletHref && (
            <Link
              href={gauntletHref}
              className={`${PILL_CLS} text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)]`}
            >
              Gauntlet live
            </Link>
          )}
        </div>
        <Link
          href={seasonHref}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-site-accent)] transition-colors shrink-0"
        >
          View all →
        </Link>
      </div>
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
              const href = `/players/${p.player_id}`;
              return (
                <Tr key={p.player_id} href={href}>
                  <Td align="left" muted>{i + 1}</Td>
                  <NameTd>
                    <Link href={href} className="flex items-center w-full h-full">
                      <PlayerName name={p.player_name} isMe={currentPlayerId !== null && p.player_id === currentPlayerId} />
                    </Link>
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
