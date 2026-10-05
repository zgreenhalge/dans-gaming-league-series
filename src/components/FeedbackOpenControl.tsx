'use client';

// Status line plus one open/close button, shared by the survey and superlatives admin panels.
// Opening is the primary button, closing the small bordered one.

import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS } from './ArmedConfirmButton';

export function FeedbackOpenControl({
  isOpen,
  status,
  openLabel,
  closeLabel,
  busy,
  onToggle,
}: {
  isOpen: boolean;
  /** What's been answered so far, e.g. "3 of 14 players responded". */
  status: string;
  openLabel: string;
  closeLabel: string;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        {isOpen ? 'Open' : 'Closed'} · {status}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`${isOpen ? ADMIN_SMALL_BUTTON_CLS : ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
      >
        {isOpen ? closeLabel : openLabel}
      </button>
    </div>
  );
}
