// Shared layout for a season-page feedback tab (survey form, superlatives ballot or results): a top
// row of controls (the admin's Manage link, the player's Edit button), then the explanatory note
// across the full tab width, then the body.

import type { ReactNode } from 'react';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';

export function FeedbackFormFrame({
  manage,
  actions,
  note,
  children,
}: {
  manage?: ReactNode;
  actions?: ReactNode;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {(manage || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {manage}
          {actions}
        </div>
      )}
      {note && <p className="font-mono text-[12px] text-[var(--color-text-secondary)]">{note}</p>}
      {children}
    </div>
  );
}

/** The player's "Edit" button for a read-only submitted form, plus a "Saved" confirmation after a save. */
export function EditAnswersControl({ saved, onEdit }: { saved: boolean; onEdit: () => void }) {
  return (
    <>
      <button type="button" onClick={onEdit} className={ADMIN_SMALL_BUTTON_CLS}>
        Edit
      </button>
      {saved && <span className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Saved</span>}
    </>
  );
}
