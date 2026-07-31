// Shared collapsed/expanded section — a native <details>/<summary> (no JS needed) with a clearer
// affordance than the browser's own tiny disclosure triangle: the same ▸/▾ glyph MatchManager's
// custom-JS row toggle already uses, driven here by Tailwind's `group-open:` variant so it rotates on
// the native `open` state instead of duplicated React state. `preview` renders next to the title and
// stays visible while collapsed, so a problem inside (e.g. a paused schedule) still reads at a glance
// without expanding. Reach for this anywhere a section is used less often than its neighbors and
// deserves to start out of the way — see docs/visual-conventions.md's "Console & admin-surface shapes".

import type { ReactNode } from 'react';

export function CollapsiblePanel({
  title,
  preview,
  defaultOpen = false,
  children,
  className = '',
}: {
  title: ReactNode;
  /** Shown next to the title, visible even while collapsed — a live status summary, a count, etc. */
  preview?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group border border-[var(--color-border-tertiary)] open:border-[var(--color-border-secondary)] rounded px-4 py-3 transition-colors ${className}`}
    >
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] inline-block transition-transform duration-150 group-open:rotate-90">
            ▸
          </span>
          <span className="font-mono text-[12px] text-[var(--color-text-secondary)] group-open:text-[var(--color-text-primary)] truncate transition-colors">
            {title}
          </span>
        </span>
        {preview && <span className="shrink-0">{preview}</span>}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
