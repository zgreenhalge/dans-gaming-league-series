'use client';

import Link from 'next/link';
import { scrimMatchHref } from '@/lib/crumbs';
import ErrorText from './ErrorText';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';
import { useRefreshingAction } from './useRefreshingAction';

/** For an admin: the night's matches that are over but have no score (the demo is parsing, or the
 *  server stopped early). Each links to its page to confirm the result, or is discarded here. */
export function ScrimAwaitingScore({ matches }: { matches: { id: number; match_number: number }[] }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <div className="mb-2 font-mono text-[12px] text-[var(--color-text-secondary)]">
      <div className="mb-1">
        {matches.length === 1 ? 'This match has' : 'These matches have'} no score yet. Open {matches.length === 1 ? 'it' : 'one'} to confirm the result, or discard.
      </div>
      {matches.map((m) => (
        <div key={m.id} className="flex items-center gap-3 py-0.5">
          <Link href={scrimMatchHref(m.id)} className="underline hover:text-[var(--color-text-primary)]">Match {m.match_number}</Link>
          <button type="button" onClick={() => act('DELETE', `/api/scrims/matches/${m.id}`)} disabled={busy} className={`${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}>
            Discard
          </button>
        </div>
      ))}
      <ErrorText error={error} size={12} />
    </div>
  );
}
