// Shared tab-bar + filter-controls layout. Tabs sit on the left and any filter
// controls (season filter, side checkboxes, etc.) are pushed right via
// `ml-auto`. Everything is `flex-wrap`, so on narrow viewports the controls drop
// to a new line instead of overrunning the page — the behavior the player-page
// seasonal filters already had, now consistent everywhere. Tab buttons stay the
// caller's responsibility (they vary per page); this only owns the container.

export default function TabBar({
  children,
  controls,
  bordered = false,
  className = '',
}: {
  /** The tab buttons. */
  children: React.ReactNode;
  /** Right-aligned filter controls. */
  controls?: React.ReactNode;
  /** Draw the standard bottom rule under the bar. */
  bordered?: boolean;
  /** Extra classes on the outer container (margins, etc.). */
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-y-2 ${
        bordered ? 'border-b border-[var(--color-border-primary)]' : ''
      } ${className}`}
    >
      <div className="flex flex-wrap items-center">{children}</div>
      {controls && (
        <div className="ml-auto flex flex-wrap items-center gap-4 pb-0.5">{controls}</div>
      )}
    </div>
  );
}
