'use client';

import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useRefreshingAction } from './useRefreshingAction';

/** Discard a scrim match (`DELETE /api/scrims/matches/[id]`), after a confirm: it deletes the match
 *  and its player rows. Used wherever a lobby, queued or unscored match offers Discard. */
export function ScrimDiscardButton({ matchId }: { matchId: number }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <ArmedConfirmButton
      onConfirm={() => act('DELETE', `/api/scrims/matches/${matchId}`)}
      busy={busy}
      error={error}
      triggerLabel="Discard"
      confirmLabel="Confirm discard"
      busyLabel="Discarding…"
      variant="danger"
    />
  );
}
