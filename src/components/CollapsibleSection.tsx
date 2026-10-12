'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * A bordered section under a collapsible title bar — the same look as a week row in the season's
 * Schedule tab (`WeekBlock`, `ScheduleList.tsx`): a tinted bar with a +/− toggle, the title and a
 * quiet detail, and an "Open →" link to the section's own page on the right.
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
  /** The section's own page; omit for no link. */
  href?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`lift-row w-full px-4 py-2.5 ${href ? 'pr-20' : ''} flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-left`}
        >
          <span className="text-[var(--color-text-secondary)] text-[12px] leading-none select-none w-3 shrink-0">{open ? '−' : '+'}</span>
          <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
            <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">{title}</span>
            {detail && <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{detail}</span>}
          </div>
        </button>
        {href && (
          <Link
            href={href}
            className="absolute right-3 top-1/2 -translate-y-1/2 tracked text-[10px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Open →
          </Link>
        )}
      </div>
      {open && children}
    </div>
  );
}
