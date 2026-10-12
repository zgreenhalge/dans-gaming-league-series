import Th from './Th';
import { PlayerName } from './PlayerName';
import type { WeekScorecardRow, GroupRow } from '@/lib/stage-views';
import type { RankMovement } from '@/lib/season-standings';

// The scorecard tables on the week, round and group pages. Both show the exact values the ranking is
// computed from (`deriveGroupScorecard()` / `canonicalGauntletRankMap()` — group-scorecard.ts), in the
// order they rank by, with a caption naming the rule.

const td = 'py-2 px-3 font-mono text-[12px] tnum';
const nameTd = 'py-2 px-3 font-display text-[14px] font-semibold';

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'][(v - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][v] ?? 'th';
  return `${n}${suffix}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
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

function Frame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-max">{children}</table>
      </div>
      <p className="px-3 py-2 font-mono text-[10px] text-[var(--color-text-secondary)] border-t border-[var(--color-border-tertiary)] bg-[var(--color-bg-secondary)]">
        {caption}
      </p>
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
  return (
    <Frame
      caption={`Ranked by Wins → RWR% → ADR, the same order as the season standings.${
        showMovement ? " Season shows each player's standing after this week and how far it moved." : ''
      }`}
    >
      <thead className="bg-[var(--color-bg-secondary)]">
        <tr>
          <Th>#</Th>
          <Th>Player</Th>
          <Th align="right">W-L</Th>
          <Th align="right">RWR%</Th>
          <Th align="right">ADR</Th>
          <Th align="right">K/A/D</Th>
          {showMovement && <Th align="right">Season</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player_id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
            <td className={`${td} text-[var(--color-text-secondary)]`}>{r.rank}</td>
            <td className={nameTd}>
              <PlayerName name={r.player_name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
            </td>
            <td className={`${td} text-right font-semibold`}>
              {r.wins}-{r.losses}
            </td>
            <td className={`${td} text-right`}>{pct(r.rwr_percentage)}</td>
            <td className={`${td} text-right`}>{r.adr.toFixed(1)}</td>
            <td className={`${td} text-right text-[var(--color-text-secondary)]`}>
              {r.kills}/{r.assists}/{r.deaths}
            </td>
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
  caption,
  currentPlayerId,
}: {
  rows: GroupRow[];
  isFinal: boolean;
  finished: boolean;
  caption: string;
  currentPlayerId: number | null;
}) {
  return (
    <Frame caption={caption}>
      <thead className="bg-[var(--color-bg-secondary)]">
        <tr>
          <Th>#</Th>
          <Th align="right">Seed</Th>
          <Th>Player</Th>
          <Th align="right">W-L</Th>
          <Th align="right">RWR%</Th>
          <Th align="right">ADR</Th>
          <Th align="right">{isFinal ? 'Place' : 'Result'}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.player_id} className="border-b border-[var(--color-border-tertiary)] last:border-b-0">
            <td className={`${td} text-[var(--color-text-secondary)]`}>{r.rank ?? '–'}</td>
            <td className={`${td} text-right text-[var(--color-text-secondary)]`}>{r.seed ?? '–'}</td>
            <td className={nameTd}>
              <PlayerName name={r.player_name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
            </td>
            <td className={`${td} text-right font-semibold`}>
              {r.matches_played > 0 ? `${r.wins}-${r.losses}` : '–'}
            </td>
            <td className={`${td} text-right`}>{r.matches_played > 0 ? pct(r.rwr_percentage) : '–'}</td>
            <td className={`${td} text-right`}>{r.matches_played > 0 ? r.adr.toFixed(1) : '–'}</td>
            <td className={`${td} text-right`}>
              <Outcome row={finished ? r : { ...r, rank: null }} isFinal={isFinal} />
            </td>
          </tr>
        ))}
      </tbody>
    </Frame>
  );
}
