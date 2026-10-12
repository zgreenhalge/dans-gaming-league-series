'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * The title bar of a collapsible stage section (a week, a gauntlet round, a gauntlet group): a
 * tinted bar in two segments — a caret button that expands/collapses the section, and the title,
 * which is a link to the stage's own page. Without an `href` the whole bar is one toggle button.
 * `label` names the stage for the caret's accessible name ("Week 3").
 */
export function StageBar({
  open,
  onToggle,
  href,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  href?: string;
  label: string;
  /** The title content: the stage's name and its quiet detail. */
  children: React.ReactNode;
}) {
  const bar = 'flex items-stretch border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]';
  const caret = (
    <ChevronRight
      aria-hidden
      className={`w-4 h-4 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? 'rotate-90' : ''}`}
    />
  );
  const titleCls = 'lift-row flex-1 min-w-0 px-4 py-2.5 flex items-center gap-3 text-left';

  if (!href) {
    return (
      <div className={bar}>
        <button type="button" onClick={onToggle} aria-expanded={open} className={`${titleCls} w-full`}>
          {caret}
          {children}
        </button>
      </div>
    );
  }
  return (
    <div className={bar}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
        className="lift-row px-3 flex items-center border-r border-[var(--color-border-primary)]"
      >
        {caret}
      </button>
      <Link href={href} className={titleCls}>
        {children}
      </Link>
    </div>
  );
}
