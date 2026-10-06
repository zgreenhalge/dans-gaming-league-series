'use client';

// The player-facing superlatives ballot: one nominee picker per superlative, drawn from everyone
// who played the season. Saving again replaces the player's existing ballot (see
// `PUT /api/seasons/[id]/superlatives/votes`); a superlative left on "No vote" has its vote cleared.
// Once a player has votes saved the ballot shows read-only until they press Edit.

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';
import { EditAnswersControl, FeedbackFormFrame } from './FeedbackFormFrame';

export function SuperlativesBallot({
  seasonId,
  superlatives,
  nominees,
  initialVotes,
  manage,
  note,
}: {
  seasonId: number;
  superlatives: { id: number; title: string }[];
  nominees: { id: number; name: string }[];
  initialVotes: Record<number, number>;
  /** The admin's Manage link, shown in the top row beside Edit. */
  manage?: ReactNode;
  note: string;
}) {
  const router = useRouter();
  const [votes, setVotes] = useState<Record<number, number>>(initialVotes);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(() => Object.keys(initialVotes).length === 0);
  const { busy, error, run } = useAsyncAction();

  function setVote(superlativeId: number, nomineeId: number | null) {
    setSaved(false);
    setVotes((prev) => {
      const next = { ...prev };
      if (nomineeId == null) delete next[superlativeId];
      else next[superlativeId] = nomineeId;
      return next;
    });
  }

  async function save() {
    await run(async () => {
      await sendFeedbackRequest('PUT', `/api/seasons/${seasonId}/superlatives/votes`, {
        // Skips a vote for a superlative the admin has since removed, which the server would reject.
        votes: superlatives.flatMap((s) => (votes[s.id] != null ? [{ superlative_id: s.id, nominee_player_id: votes[s.id] }] : [])),
      });
      setSaved(true);
      setEditing(Object.keys(votes).length === 0);
      router.refresh();
    });
  }

  const hasSavedVotes = Object.keys(initialVotes).length > 0 || saved;
  const nomineeName = (id: number | undefined) => nominees.find((p) => p.id === id)?.name;

  const readOnly = (
    <div className="flex flex-col gap-6">
      {superlatives.map((s) => (
        <div key={s.id} className="flex flex-col gap-1">
          <span className="font-display text-[16px] font-semibold">{s.title}</span>
          <span className="font-mono text-[13px] text-[var(--color-text-secondary)]">{nomineeName(votes[s.id]) ?? 'No vote'}</span>
        </div>
      ))}
    </div>
  );

  const form = (
    <div className="flex flex-col gap-6">
      {superlatives.map((s) => (
        <label key={s.id} className="flex flex-col gap-2">
          <span className="font-display text-[16px] font-semibold">{s.title}</span>
          <select
            value={votes[s.id] ?? ''}
            onChange={(e) => setVote(s.id, e.target.value === '' ? null : Number(e.target.value))}
            className={FORM_INPUT_CLS}
          >
            <option value="">No vote</option>
            {nominees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ))}

      <div className="flex items-center gap-4">
        <button type="button" onClick={save} disabled={busy} className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}>
          {busy ? 'Saving…' : 'Save Votes'}
        </button>
        {hasSavedVotes && (
          <button
            type="button"
            onClick={() => {
              setVotes(initialVotes);
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
  );

  return (
    <FeedbackFormFrame
      manage={manage}
      actions={
        !editing && (
          <EditAnswersControl
            saved={saved}
            onEdit={() => {
              setSaved(false);
              setEditing(true);
            }}
          />
        )
      }
      note={note}
    >
      <div className="max-w-[720px]">{editing ? form : readOnly}</div>
    </FeedbackFormFrame>
  );
}
