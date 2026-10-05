'use client';

// Admin view of a season's superlatives vote: choose the superlatives, open/close voting, and see
// the anonymised tallies (who got how many votes — never who voted for whom).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';
import { MAX_SUPERLATIVE_TITLE_LENGTH } from '@/lib/survey';
import type { SuperlativeAdminResults } from '@/lib/queries';


export function SuperlativesAdminPanel({ seasonId, poll }: { seasonId: number; poll: SuperlativeAdminResults | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const { busy, error, run } = useAsyncAction();
  const url = `/api/seasons/${seasonId}/superlatives`;

  function mutate(action: () => Promise<void>) {
    return run(async () => {
      await action();
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="font-display text-[20px] font-semibold">Superlatives vote</div>

      {poll && (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
          <span className="text-[var(--color-text-secondary)]">
            {poll.isOpen ? 'Voting open' : 'Voting closed'} · {poll.voterCount} of {poll.eligibleCount} players voted
          </span>
          <button
            type="button"
            onClick={() => mutate(() => sendFeedbackRequest('PATCH', url, { open: !poll.isOpen }))}
            disabled={busy}
            className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}
          >
            {poll.isOpen ? 'Close voting' : 'Open voting'}
          </button>
        </div>
      )}

      {poll?.superlatives.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 border-t border-[var(--color-border-tertiary)] pt-4">
          <div className="flex items-center gap-3">
            <div className="font-display text-[15px] font-semibold">{s.title}</div>
            <button
              type="button"
              onClick={() => mutate(() => sendFeedbackRequest('DELETE', url, { superlative_id: s.id }))}
              disabled={busy}
              className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}
            >
              Remove
            </button>
          </div>
          {s.nominees.length === 0 ? (
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No votes yet</div>
          ) : (
            <ol className="flex flex-col gap-1 font-mono text-[13px]">
              {s.nominees.map((n) => (
                <li key={n.player_id}>
                  {n.player_name} — {n.votes} {n.votes === 1 ? 'vote' : 'votes'}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}

      <form
        className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-tertiary)] pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(async () => {
            await sendFeedbackRequest('POST', url, { title });
            setTitle('');
          });
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_SUPERLATIVE_TITLE_LENGTH}
          placeholder="New superlative, e.g. Best Teammate"
          className={`${FORM_INPUT_CLS} flex-1 min-w-[220px]`}
        />
        <button type="submit" disabled={busy || !title.trim()} className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}>
          Add superlative
        </button>
      </form>
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </section>
  );
}
