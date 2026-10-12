'use client';

// The player-facing shell shared by the survey form and the superlatives ballot: the read-only →
// Edit → Save/Cancel state machine, the "Saved" confirmation, the busy/error line, and the `PUT` +
// `router.refresh()` save. A form supplies only its answer inputs, their read-only rendering, and the
// request body; it owns its own answer state and resets it on `onCancel`. A player who has already
// responded sees the read-only view until they press Edit.

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { FeedbackFormFrame } from './FeedbackFormFrame';

export function FeedbackEditor({
  url,
  responded,
  body,
  onCancel,
  manage,
  note,
  submitLabel,
  updateLabel,
  renderForm,
  renderReadOnly,
}: {
  /** The `PUT` endpoint that replaces the player's answers. */
  url: string;
  /** Whether the player already has answers saved: starts read-only and shows Cancel. */
  responded: boolean;
  /** The request body for the current answers. */
  body: unknown;
  /** Restores the form's answers to what was last saved. */
  onCancel: () => void;
  /** The admin's Manage link, shown in the top row beside Edit. */
  manage?: ReactNode;
  note: string;
  /** Save button text for a first submission; `updateLabel` (default the same) once answers exist. */
  submitLabel: string;
  updateLabel?: string;
  renderForm: () => ReactNode;
  renderReadOnly: () => ReactNode;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(!responded);
  const { busy, error, run } = useAsyncAction();
  const hasSaved = responded || saved;

  async function save() {
    await run(async () => {
      await sendFeedbackRequest('PUT', url, body);
      setSaved(true);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <FeedbackFormFrame
      manage={manage}
      edit={
        editing
          ? undefined
          : {
              saved,
              onEdit: () => {
                setSaved(false);
                setEditing(true);
              },
            }
      }
      note={note}
    >
      {editing ? (
        <div className="flex flex-col gap-6">
          {renderForm()}
          <div className="flex items-center gap-4">
            <button type="button" onClick={save} disabled={busy} className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}>
              {busy ? 'Saving…' : hasSaved ? (updateLabel ?? submitLabel) : submitLabel}
            </button>
            {hasSaved && (
              <button
                type="button"
                onClick={() => {
                  onCancel();
                  setEditing(false);
                }}
                disabled={busy}
                className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] disabled:opacity-40"
              >
                Cancel
              </button>
            )}
            {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
          </div>
        </div>
      ) : (
        renderReadOnly()
      )}
    </FeedbackFormFrame>
  );
}
