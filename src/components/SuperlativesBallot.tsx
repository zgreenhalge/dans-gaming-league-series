'use client';

// The player-facing superlatives ballot: one nominee picker per superlative, drawn from everyone
// who played the season. Saving again replaces the player's existing ballot (see
// `PUT /api/seasons/[id]/superlatives/votes`); a superlative left on "No vote" has its vote cleared.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';

export function SuperlativesBallot({
  seasonId,
  superlatives,
  nominees,
  initialVotes,
}: {
  seasonId: number;
  superlatives: { id: number; title: string }[];
  nominees: { id: number; name: string }[];
  initialVotes: Record<number, number>;
}) {
  const router = useRouter();
  const [votes, setVotes] = useState<Record<number, number>>(initialVotes);
  const [saved, setSaved] = useState(false);
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
        votes: Object.entries(votes).map(([superlative_id, nominee_player_id]) => ({
          superlative_id: Number(superlative_id),
          nominee_player_id,
        })),
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
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
        {saved && <span className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Saved</span>}
        {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
      </div>
    </div>
  );
}
