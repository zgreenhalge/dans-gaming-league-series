/** A small "?" badge that reveals `children` in a popover on hover or keyboard focus — the
 *  site's one hover-for-definition primitive (originally `WinProbabilityBar.tsx`'s own
 *  `WinProbabilityTooltip`, generalized here once a second caller needed the same UI). Reach for
 *  this instead of a bespoke tooltip whenever a label needs a fuller explanation than fits inline
 *  or in a `title` attribute (which can't hold multi-line/formatted content). */
export function InfoTooltip({
  children,
  width = 'w-56',
  className = '',
}: {
  children: React.ReactNode;
  /** Tailwind width class for the popover panel — widen for longer explanations. */
  width?: string;
  /** Extra classes on the outer trigger span, e.g. `ml-1.5` to space it off preceding text. */
  className?: string;
}) {
  return (
    <span tabIndex={0} className={`group relative inline-flex items-center cursor-help ${className}`}>
      <span className="border border-[var(--color-border-secondary)] rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none font-mono text-[9px] text-[var(--color-text-secondary)]">
        ?
      </span>
      <span className={`pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 ${width} rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-2 font-mono text-[10px] leading-snug normal-case text-[var(--color-text-secondary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 z-10`}>
        {children}
      </span>
    </span>
  );
}
