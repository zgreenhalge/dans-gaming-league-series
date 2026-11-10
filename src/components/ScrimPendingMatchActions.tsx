'use client';

import { useRouter } from 'next/navigation';
import ErrorText from './ErrorText';
import { AdminMenu } from './AdminMenu';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useRefreshingAction } from './useRefreshingAction';
import { scrimMatchHref } from '@/lib/crumbs';
import { isScrimMatchDiscardable } from '@/lib/scrim-matches';
import type { ScrimMatch } from '@/lib/queries';

/** An admin's row under a Pending match in a scrim night's running order (its game is over with no
 *  score), with an `AdminMenu`: **Confirm result…** opens the match page, where its demo review confirms
 *  the score, and **Discard…** arms a confirm in the menu before deleting the match and its player rows
 *  (`DELETE /api/scrims/matches/[id]`) — held while the match still holds the server
 *  (`isScrimMatchDiscardable()`). A failed discard's error shows on the row. */
export function ScrimPendingMatchActions({ match }: { match: ScrimMatch }) {
  const router = useRouter();
  const { busy, error, act } = useRefreshingAction();
  return (
    <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 font-mono text-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[var(--color-text-secondary)]">Match {match.match_number} is awaiting its score</span>
        <AdminMenu
          label={`Admin actions for match ${match.match_number}`}
          items={[
            { label: 'Confirm result…', onSelect: () => router.push(scrimMatchHref(match.id)) },
            {
              label: 'Discard…',
              danger: true,
              disabled: busy || !isScrimMatchDiscardable(match),
              content: (close) => (
                <ArmedConfirmButton
                  armed
                  onArm={() => {}}
                  onCancel={close}
                  onConfirm={() => {
                    close();
                    return act('DELETE', `/api/scrims/matches/${match.id}`);
                  }}
                  busy={busy}
                  triggerLabel="Discard"
                  confirmLabel={`Discard match ${match.match_number}`}
                  busyLabel="Discarding…"
                  variant="danger"
                />
              ),
            },
          ]}
        />
      </div>
      <ErrorText error={error} size={12} />
    </div>
  );
}
