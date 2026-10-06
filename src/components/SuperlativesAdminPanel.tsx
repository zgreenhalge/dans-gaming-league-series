'use client';

// Admin view of a season's superlatives vote: choose the superlatives, open/close voting, and see
// the anonymised tallies (who got how many votes — never who voted for whom).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_SMALL_BUTTON_CLS, FORM_INPUT_CLS } from './ArmedConfirmButton';
import { FeedbackOpenControl } from './FeedbackOpenControl';
import { RemoveXButton } from './RemoveXButton';
import { SortableList } from './SortableList';
import { MAX_SUPERLATIVE_TITLE_LENGTH } from '@/lib/survey';
import type { SuperlativeAdminResults } from '@/lib/queries';

export function SuperlativesAdminPanel({ seasonId, poll }: { seasonId: number; poll: SuperlativeAdminResults | null }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const { busy, error, run } = useAsyncAction();
  const url = `/api/seasons/${seasonId}/superlatives`;
  // The list is frozen once voting opens (the server enforces it): open now, or votes already cast.
  const locked = !!poll && (poll.isOpen || poll.voterCount > 0);

  function mutate(action: () => Promise<void>) {
    return run(async () => {
      await action();
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      {poll && (
        <FeedbackOpenControl
          isOpen={poll.isOpen}
          status={`${poll.voterCount} of ${poll.eligibleCount} players voted`}
          openLabel="Open voting"
          closeLabel="Close voting"
          busy={busy}
          onToggle={() => mutate(() => sendFeedbackRequest('PATCH', url, { open: !poll.isOpen }))}
        />
      )}

      {poll && (
      <SortableList
        items={poll.superlatives}
        getKey={(s) => s.id}
        disabled={busy || locked}
        onReorder={(next) => mutate(() => sendFeedbackRequest('PUT', url, { order: next.map((x) => x.id) }))}
        renderRow={(s, _i, handle) => {
        return (
        <div key={s.id} className="flex flex-col gap-2 border-t border-[var(--color-border-tertiary)] pt-4">
          <div className="flex items-center gap-3">
            {handle}
            {editingId === s.id ? (
              <form
                className="flex flex-1 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(async () => {
                    await sendFeedbackRequest('PATCH', url, { superlative_id: s.id, title: editTitle });
                    setEditingId(null);
                  });
                }}
              >
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={MAX_SUPERLATIVE_TITLE_LENGTH}
                  className={`${FORM_INPUT_CLS} flex-1 min-w-[220px]`}
                />
                <button type="submit" disabled={busy || !editTitle.trim()} className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}>
                  Save
                </button>
                <button type="button" onClick={() => setEditingId(null)} disabled={busy} className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <div className="font-display text-[15px] font-semibold">{s.title}</div>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setEditTitle(s.title);
                    }}
                    disabled={busy}
                    className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}
                  >
                    Edit
                  </button>
                )}
              </>
            )}
            {!locked && (
              <RemoveXButton
                label={`Remove ${s.title}`}
                onClick={() => mutate(() => sendFeedbackRequest('DELETE', url, { superlative_id: s.id }))}
                disabled={busy}
              />
            )}
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
        );
        }}
      />
      )}

      {!locked && (
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
        <button type="submit" disabled={busy || !title.trim()} className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}>
          Add superlative
        </button>
      </form>
      )}
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </section>
  );
}
