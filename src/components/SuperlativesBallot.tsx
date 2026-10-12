'use client';

// The player-facing superlatives ballot: one nominee picker per superlative, drawn from everyone
// who played the season. Saving again replaces the player's existing ballot (see
// `PUT /api/seasons/[id]/superlatives/votes`); a superlative left on "No vote" has its vote cleared.
// The Edit/Save/Cancel flow is `FeedbackEditor`; this file is the nominee pickers.

import { useState, type ReactNode } from 'react';
import { FORM_INPUT_CLS } from './ArmedConfirmButton';
import { FeedbackEditor } from './FeedbackEditor';

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
  const [votes, setVotes] = useState<Record<number, number>>(initialVotes);

  function setVote(superlativeId: number, nomineeId: number | null) {
    setVotes((prev) => {
      const next = { ...prev };
      if (nomineeId == null) delete next[superlativeId];
      else next[superlativeId] = nomineeId;
      return next;
    });
  }

  const nomineeName = (id: number | undefined) => nominees.find((p) => p.id === id)?.name;

  const renderReadOnly = () => (
    <div className="flex flex-col gap-6">
      {superlatives.map((s) => (
        <div key={s.id} className="flex flex-col gap-1">
          <span className="font-display text-[16px] font-semibold">{s.title}</span>
          <span className="font-mono text-[13px] text-[var(--color-text-secondary)]">{nomineeName(votes[s.id]) ?? 'No vote'}</span>
        </div>
      ))}
    </div>
  );

  const renderForm = () => (
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
    </div>
  );

  return (
    <FeedbackEditor
      url={`/api/seasons/${seasonId}/superlatives/votes`}
      responded={Object.keys(initialVotes).length > 0}
      // Skips a vote for a superlative the admin has since removed, which the server would reject.
      body={{
        votes: superlatives.flatMap((s) => (votes[s.id] != null ? [{ superlative_id: s.id, nominee_player_id: votes[s.id] }] : [])),
      }}
      onCancel={() => setVotes(initialVotes)}
      manage={manage}
      note={note}
      submitLabel="Save Votes"
      renderForm={renderForm}
      renderReadOnly={renderReadOnly}
    />
  );
}
