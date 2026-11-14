'use client';

import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useRefreshingAction } from './useRefreshingAction';

/** Discard a scrim match (`DELETE /api/scrims/matches/[id]`), after a confirm: it deletes the match
 *  and its player rows — refused, and the page reloaded, when someone changed it since the page
 *  rendered `revision`. Used wherever a lobby, queued or unscored match offers Discard. */
export function ScrimDiscardButton({ matchId, revision }: { matchId: number; revision: number }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <ArmedConfirmButton
      onConfirm={() => act('DELETE', `/api/scrims/matches/${matchId}`, { revision })}
      busy={busy}
      error={error}
      triggerLabel="Discard"
      confirmLabel="Confirm discard"
      busyLabel="Discarding…"
      variant="danger"
    />
  );
}
