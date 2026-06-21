// Shared label/value stat-panel used wherever we show a fixed set of metrics as
// tiles instead of a one-row table (player Overview, single-player Advanced
// Stats, etc.). One bordered container with 1px grid-line dividers between
// tiles — the grid's background shows through `gap-px`, so the lines wrap
// correctly in both directions. See docs/visual-conventions.md.

export interface StatTile {
  label: string;
  value: React.ReactNode;
  /** Tooltip — kept in sync with the equivalent table column's `title`. */
  title?: string;
  /** Inline style for the value (e.g. Plus-stat color scale). */
  valueStyle?: React.CSSProperties;
}

export default function StatTileGrid({
  tiles,
  columns = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
  heading,
  hint,
}: {
  tiles: StatTile[];
  /** Responsive grid-template-columns classes. */
  columns?: string;
  /** Optional section heading rendered above the grid. */
  heading?: string;
  /** Tooltip for the heading. */
  hint?: string;
}) {
  return (
    <div>
      {heading && (
        <h3 className="mb-3 text-sm font-semibold" title={hint}>
          {heading}
        </h3>
      )}
      <div className="border border-[var(--color-border-primary)]">
        <div className={`grid gap-px bg-[var(--color-border-tertiary)] ${columns}`}>
          {tiles.map((t) => (
            <div key={t.label} title={t.title} className="bg-[var(--color-bg-primary)] px-3 py-3">
              <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1">{t.label}</div>
              <div className="font-display text-[20px] font-semibold tnum leading-none" style={t.valueStyle}>
                {t.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
