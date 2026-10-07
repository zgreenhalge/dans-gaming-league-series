// Shared layout for a season-page feedback tab (survey form, superlatives ballot or results): a top
// row of controls (the admin's Manage link, the player's Edit button), then the explanatory note
// across the full tab width, then the body (capped to a readable width unless `wide`).

import type { ReactNode } from 'react';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';

export function FeedbackFormFrame({
  manage,
  edit,
  note,
  wide,
  children,
}: {
  manage?: ReactNode;
  /** Set once the player has submitted and the form is read-only: shows their Edit button. Holds a
   *  handler, so only a client component can pass it. */
  edit?: { saved: boolean; onEdit: () => void };
  note?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {(manage || edit) && (
        <div className="flex flex-wrap items-center gap-2">
          {manage}
          {edit && <EditAnswersControl {...edit} />}
        </div>
      )}
      {note && <p className="font-mono text-[12px] text-[var(--color-text-secondary)]">{note}</p>}
      <div className={wide ? undefined : 'max-w-[720px]'}>{children}</div>
    </div>
  );
}

/** The player's "Edit" button for a read-only submitted form, plus a "Saved" confirmation after a save. */
function EditAnswersControl({ saved, onEdit }: { saved: boolean; onEdit: () => void }) {
  return (
    <>
      <button type="button" onClick={onEdit} className={ADMIN_SMALL_BUTTON_CLS}>
        Edit
      </button>
      {saved && <span className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Saved</span>}
    </>
  );
}
