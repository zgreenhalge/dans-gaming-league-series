'use client';

import { useState } from 'react';
import { StageBar } from './StageBar';

/**
 * A bordered section under a collapsible title bar — the one card shell for a stage: a week row or a
 * gauntlet round row in the season hub's Schedule tab, and a group on a round page. A caret expands
 * and collapses it, and the title (with a quiet detail) links to the stage's own page. The caret's
 * accessible name comes from `title` ("Collapse Week 3").
 *
 * Uncontrolled by default (`defaultOpen`). Pass `open` and `onToggle` to hold the state elsewhere —
 * the hub's lists keep it in the URL so a link can open a given week or round.
 */
export function CollapsibleSection({
  title,
  detail,
  trailing,
  href,
  id,
  open,
  onToggle,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Mono text beside the title, like a week's date window. */
  detail?: string;
  /** Content after the title, inside the bar — a week's bye player. */
  trailing?: React.ReactNode;
  /** The section's own page; omit and the whole bar toggles instead. */
  href?: string;
  /** Anchor id on the section, for links that scroll to it. */
  id?: string;
  /** Controlled open state; with it, `onToggle` is called instead of the section toggling itself. */
  open?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;
  const toggle = open === undefined ? () => setInnerOpen((v) => !v) : (onToggle ?? (() => {}));
  return (
    <div id={id} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <StageBar open={isOpen} onToggle={toggle} href={href} label={title}>
        <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
          <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">{title}</span>
          {detail && <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{detail}</span>}
        </div>
        {trailing}
      </StageBar>
      {isOpen && children}
    </div>
  );
}
