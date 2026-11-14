'use client';

import { useRouter } from 'next/navigation';
import { AdminMenu } from './AdminMenu';
import { ScrimDiscardButton } from './ScrimDiscardButton';
import { scrimMatchHref } from '@/lib/crumbs';
import type { ScrimMatch } from '@/lib/queries';

/** An admin's row under a Pending match in a scrim night's running order (its game is over with no
 *  score), with an `AdminMenu`: **Confirm result…** opens the match page, where its demo review confirms
 *  the score, and **Discard…** opens the night page's `ScrimDiscardButton` in the menu. */
export function ScrimPendingMatchActions({ match }: { match: ScrimMatch }) {
  const router = useRouter();
  return (
    <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 flex items-center justify-between gap-3 font-mono text-[12px]">
      <span className="text-[var(--color-text-secondary)]">Match {match.match_number} is awaiting its score</span>
      <AdminMenu
        label={`Admin actions for match ${match.match_number}`}
        items={[
          { label: 'Confirm result…', onSelect: () => router.push(scrimMatchHref(match.id)) },
          { label: 'Discard…', danger: true, content: () => <ScrimDiscardButton matchId={match.id} revision={match.revision} /> },
        ]}
      />
    </div>
  );
}
