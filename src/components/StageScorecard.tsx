'use client';

import SortableTh from './SortableTh';
import Th from './Th';
import { PlayerName } from './PlayerName';
import { useSortState } from './useSortState';
import { sortRows, type SortValue } from '@/lib/sort-rows';
import { hasPlayed, type PlayerRecord } from '@/lib/group-scorecard';
import type { WeekScorecardRow, GroupRow } from '@/lib/stage-views';
import type { RankMovement } from '@/lib/season-standings';

// The scorecard tables on the week, round and group pages. Both show the exact values the ranking is
// computed from (`deriveGroupScorecard()` / `canonicalGauntletRankMap()` — group-scorecard.ts), in the
// order they rank by (the rows open in that order), and every column header re-sorts them.

/** Columns that sort ascending on first click: places, seeds and names read best smallest/A-first. */
const ASC_FIRST = ['player', 'seed', 'season', 'result'] as const;

const WEEK_SORT: Record<string, (r: WeekScorecardRow) => SortValue> = {
  player: (r) => r.player_name,
  record: (r) => r.wins * 1000 - r.losses,
  rwr: (r) => (hasPlayed(r) ? r.rwr_percentage : null),
  adr: (r) => (hasPlayed(r) ? r.adr : null),
  kd: (r) => (hasPlayed(r) ? r.kd_ratio : null),
  season: (r) => r.movement?.after ?? null,
};

const OUTCOME_ORDER = { advances: 0, eliminated: 1, pending: 2 } as const;

const td = 'p-2 font-mono text-[12px] tnum';
const nameTd = 'p-2 font-display text-[14px] font-semibold';

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'][(v - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][v] ?? 'th';
  return `${n}${suffix}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

/** A figure for a player with a played match, else a dash. */
function rateOrDash(record: Pick<PlayerRecord, 'matches_played'>, text: string): string {
  return hasPlayed(record) ? text : '–';
}

function Movement({ movement }: { movement: RankMovement | null }) {
  if (!movement) return <span className="text-[var(--color-text-secondary)]">—</span>;
  const { before, after } = movement;
  const delta = before == null ? null : before - after;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[var(--color-text-primary)]">#{after}</span>
      {delta == null ? null : delta > 0 ? (
        <span className="text-[var(--color-accent-green-fg)]">▲{delta}</span>
      ) : delta < 0 ? (
        <span className="text-[var(--color-accent-red-fg)]">▼{-delta}</span>
      ) : (
        <span className="text-[var(--color-text-secondary)]">–</span>
      )}
    </span>
  );
}

function Frame({ bare = false, children }: { bare?: boolean; children: React.ReactNode }) {
  return (
    <section className={`bg-[var(--color-bg-primary)] overflow-x-auto ${bare ? '' : 'border border-[var(--color-border-primary)]'}`}>
      <table className="w-full border-collapse min-w-max">{children}</table>
    </section>
  );
}

/** A regular-season week: who won what, ranked Wins → RWR% → ADR (the season-standings order), and
 *  how each player moved in the season standings across the week. */
export function WeekScorecard({
  rows,
  showMovement,
  currentPlayerId,
}: {
  rows: WeekScorecardRow[];
  /** Whether to show season-standings movement — not in week 1, which has nothing to move from. */
  showMovement: boolean;
  currentPlayerId: number | null;
}) {
  const [sort, onSort] = useSortState('', { ascFirst: ASC_FIRST });
  const sorted = sortRows(rows, sort, WEEK_SORT);
  return (
    <Frame>
      <thead>
        <tr>
          <SortableTh label="Player" sortKey="player" state={sort} onSort={onSort} />
          <SortableTh label="W-L" sortKey="record" state={sort} onSort={onSort} align="right" />
          <SortableTh label="RWR%" title="Round win rate" sortKey="rwr" state={sort} onSort={onSort} align="right" />
          <SortableTh label="ADR" title="Average damage per round" sortKey="adr" state={sort} onSort={onSort} align="right" />
          <SortableTh label="K/D" title="Kills per death" sortKey="kd" state={sort} onSort={onSort} align="right" />
          {showMovement && <SortableTh label="Season" title="Season standing after this week" sortKey="season" state={sort} onSort={onSort} align="right" />}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.player_id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
            <td className={nameTd}>
              <PlayerName name={r.player_name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
            </td>
            <td className={`${td} text-right font-semibold`}>
              {r.wins}-{r.losses}
            </td>
            <td className={`${td} text-right`}>{rateOrDash(r, pct(r.rwr_percentage))}</td>
            <td className={`${td} text-right`}>{rateOrDash(r, r.adr.toFixed(1))}</td>
            <td className={`${td} text-right`}>{rateOrDash(r, r.kd_ratio.toFixed(2))}</td>
            {showMovement && (
              <td className={`${td} text-right`}>
                <Movement movement={r.movement} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Frame>
  );
}

function Outcome({ row, isFinal }: { row: GroupRow; isFinal: boolean }) {
  const badge = 'tracked text-[9px] font-semibold px-1.5 py-0.5 border';
  if (isFinal && row.rank != null && row.outcome === 'pending') {
    return row.rank === 1 ? (
      <span className={`${badge} text-[var(--color-accent-amber-strong)] bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)]`}>Champion</span>
    ) : (
      <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{ordinal(row.rank)}</span>
    );
  }
  if (row.outcome === 'advances') {
    return <span className={`${badge} text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]`}>Advances</span>;
  }
  if (row.outcome === 'eliminated') {
    return <span className={`${badge} text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]`}>Eliminated</span>;
  }
  return <span className="text-[var(--color-text-secondary)]">—</span>;
}

/** A gauntlet group: each player's seed, record and the tiebreak values, in canonical gauntlet order,
 *  with who advances once both games are in. The final group shows places instead. `finished` is true
 *  once every game is played — a final's places are only real then. */
export function GroupScorecard({
  rows,
  isFinal,
  finished,
  bare = false,
  currentPlayerId,
}: {
  rows: GroupRow[];
  isFinal: boolean;
  finished: boolean;
  /** Drop the table's own border — for a table sitting flush inside a bordered container. */
  bare?: boolean;
  currentPlayerId: number | null;
}) {
  const [sort, onSort] = useSortState('', { ascFirst: ASC_FIRST });
  const sorted = sortRows<GroupRow>(rows, sort, {
    seed: (r) => r.seed,
    player: (r) => r.player_name,
    record: (r) => (hasPlayed(r) ? r.wins * 1000 - r.losses : null),
    rwr: (r) => (hasPlayed(r) ? r.rwr_percentage : null),
    adr: (r) => (hasPlayed(r) ? r.adr : null),
    result: (r) => (isFinal ? r.rank : OUTCOME_ORDER[r.outcome]),
  });
  return (
    <Frame bare={bare}>
      <thead>
        <tr>
          <SortableTh label="Seed" sortKey="seed" state={sort} onSort={onSort} align="right" />
          <SortableTh label="Player" sortKey="player" state={sort} onSort={onSort} />
          <SortableTh label="W-L" sortKey="record" state={sort} onSort={onSort} align="right" />
          <SortableTh label="RWR%" title="Round win rate" sortKey="rwr" state={sort} onSort={onSort} align="right" />
          <SortableTh label="ADR" title="Average damage per round" sortKey="adr" state={sort} onSort={onSort} align="right" />
          {/* Results only exist once every game is in; until then there is nothing to sort by. */}
          {finished ? (
            <SortableTh label={isFinal ? 'Place' : 'Result'} sortKey="result" state={sort} onSort={onSort} align="right" />
          ) : (
            <Th align="right">{isFinal ? 'Place' : 'Result'}</Th>
          )}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.player_id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
            <td className={`${td} text-right text-[var(--color-text-secondary)]`}>{r.seed ?? '–'}</td>
            <td className={nameTd}>
              <PlayerName name={r.player_name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
            </td>
            <td className={`${td} text-right font-semibold`}>{rateOrDash(r, `${r.wins}-${r.losses}`)}</td>
            <td className={`${td} text-right`}>{rateOrDash(r, pct(r.rwr_percentage))}</td>
            <td className={`${td} text-right`}>{rateOrDash(r, r.adr.toFixed(1))}</td>
            <td className={`${td} text-right`}>
              <Outcome row={finished ? r : { ...r, rank: null }} isFinal={isFinal} />
            </td>
          </tr>
        ))}
      </tbody>
    </Frame>
  );
}
