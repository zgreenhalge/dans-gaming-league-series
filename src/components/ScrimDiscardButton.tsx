'use client';

import { useState } from 'react';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useRefreshingAction } from './useRefreshingAction';

/** Discard a scrim match (`DELETE /api/scrims/matches/[id]`), after a confirm: it deletes the match
 *  and its player rows. Used wherever a lobby, queued or unscored match offers Discard. */
export function ScrimDiscardButton({ matchId }: { matchId: number }) {
  const [armed, setArmed] = useState(false);
  const { busy, error, act } = useRefreshingAction();
  return (
    <ArmedConfirmButton
      armed={armed}
      onArm={() => setArmed(true)}
      onCancel={() => setArmed(false)}
      // A discarded match leaves the page on refresh; a failed one stays armed beside its error.
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
