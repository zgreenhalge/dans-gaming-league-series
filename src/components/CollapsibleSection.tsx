'use client';

import { useState } from 'react';
import { StageBar } from './StageBar';

/**
 * A bordered section under a collapsible title bar — the same look as a week row in the season's
 * Schedule tab (`WeekBlock`, `ScheduleList.tsx`): a caret that expands/collapses it, and a title
 * (with a quiet detail) that links to the section's own page.
 */
export function CollapsibleSection({
  title,
  detail,
  href,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Mono text beside the title, like a week's date window. */
  detail?: string;
  /** The section's own page; omit and the whole bar toggles instead. */
  href?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <StageBar open={open} onToggle={() => setOpen((v) => !v)} href={href} label={title}>
        <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
          <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">{title}</span>
          {detail && <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{detail}</span>}
        </div>
      </StageBar>
      {open && children}
    </div>
  );
}
