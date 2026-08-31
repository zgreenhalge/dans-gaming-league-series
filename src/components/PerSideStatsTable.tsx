import type { PerSideStat } from '@/lib/mapSideStats';
import EmptyState from './EmptyState';
import Th from './Th';

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
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-[12px]">
            <thead>
              <tr className="bg-[var(--color-bg-secondary)]">
                <Th align="left">Side</Th>
                <Th align="right">Times Picked</Th>
                <Th align="right">W-L</Th>
                <Th align="right">Round Win%</Th>
              </tr>
            </thead>
            <tbody>
              {perSideStats.map((s) => (
                <tr key={s.side} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="pl-4 pr-3 py-2.5 tracked text-[11px] font-semibold">{s.side}</td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.numTimesPicked}</td>
                  <td className="px-3 py-2.5 text-right font-mono tnum text-[var(--color-text-primary)]">{s.wins}-{s.losses}</td>
                  <td className="px-3 pr-4 py-2.5 text-right font-mono tnum text-[var(--color-text-secondary)]">
                    {s.roundsPlayed > 0 ? `${((s.roundsWon / s.roundsPlayed) * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
