import { StatTable, Tr, Td, PlayerCell } from './StatTable';
import Th from './Th';
import EmptyState from './EmptyState';
import Link from 'next/link';
import { playerHref, scrimMatchHref } from '@/lib/crumbs';
import { toSentenceCase } from '@/lib/maps';
import { parseScore, isPlayedScore } from '@/lib/util';
import type { ScrimLeaderboardRow, ScrimMatch } from '@/lib/queries';

const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

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

/** A scrim night's scored matches, newest first: map, score and each side's K/D/ADR as stored. */
export function ScrimNightMatchList({ matches, names }: { matches: ScrimMatch[]; names: Record<number, string> }) {
  const played = matches.filter((m) => isPlayedScore(m.final_score)).reverse();
  if (played.length === 0) return <EmptyState message="No matches played yet." className="py-2" />;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {played.map((m) => {
        const score = parseScore(m.final_score);
        const side = (faction: 'SHIRTS' | 'SKINS') => {
          const won = score != null && (faction === 'SHIRTS' ? score.shirts > score.skins : score.skins > score.shirts);
          return (
            <div className="min-w-0">
              <div className={`${LABEL_CLS} mb-1`}>
                {faction === 'SHIRTS' ? 'Shirts' : 'Skins'} {score && (faction === 'SHIRTS' ? score.shirts : score.skins)}
                {won && ' · W'}
              </div>
              {m.players
                .filter((p) => p.faction === faction)
                .map((p) => (
                  <div key={p.player_id} className="flex items-center justify-between gap-2 font-mono text-[12px]">
                    <span className="truncate font-display font-semibold text-[13px]">{names[p.player_id] ?? `#${p.player_id}`}</span>
                    <span className="text-[var(--color-text-secondary)] tnum">
                      {p.kills}/{p.deaths} · {p.adr}
                    </span>
                  </div>
                ))}
            </div>
          );
        };
        return (
          <div key={m.id} className="px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <Link href={scrimMatchHref(m.id)} className="font-display text-[15px] font-semibold hover:underline">
                Match {m.match_number}
              </Link>
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{m.map ? toSentenceCase(m.map) : 'No map'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {side('SHIRTS')}
              {side('SKINS')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
