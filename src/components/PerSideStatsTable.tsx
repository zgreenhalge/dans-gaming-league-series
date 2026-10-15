import { formatRoundWinPct, type PerSideStat } from '@/lib/mapSideStats';
import EmptyState from './EmptyState';
import Th from './Th';
import { StatTable, Tr, Td, NameTd } from './StatTable';

/** The Side / Times Picked / W-L / Round Win% panel driven by `aggregatePerSideStats()` — shared
 *  by Basic Stats' Maps & Sides sub-tab (`BasicStatsView.tsx`) and Advanced Stats' Sides sub-tab
 *  (`SabremetricsLeaderboardView.tsx`) so the two never drift out of layout sync. */
export default function PerSideStatsTable({ perSideStats }: { perSideStats: PerSideStat[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Per-side stats</span>
      </div>
      {perSideStats.length === 0 ? (
        <EmptyState message="No side data." />
      ) : (
        <StatTable>
            <thead>
              <tr>
                <Th align="left">Side</Th>
                <Th align="right">Times Picked</Th>
                <Th align="right">W-L</Th>
                <Th align="right">Round Win%</Th>
              </tr>
            </thead>
            <tbody>
              {perSideStats.map((s) => (
                <Tr key={s.side}>
                  <NameTd>{s.side}</NameTd>
                  <Td>{s.numTimesPicked}</Td>
                  <Td>{s.wins}-{s.losses}</Td>
                  <Td muted>{formatRoundWinPct(s)}</Td>
                </Tr>
              ))}
            </tbody>
        </StatTable>
      )}
    </div>
  );
}
