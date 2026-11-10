'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ScrimCommitment } from '@/lib/scrim-schedule';

/** Signup and check-in writes for one player on scrim night `nightId` — a viewer's own, or an admin's
 *  for anyone. `setCommitment(id, null)` drops them out; when that removes the night (its last player),
 *  the page goes back to `/scrims`, otherwise it refreshes. `pending` is the player whose write is in
 *  flight, so only their controls show it; `busy` and `error` are `useAsyncAction()`'s. */
export function useScrimSignupWrite(nightId: number) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [target, setTarget] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  function send(playerId: number, method: 'POST' | 'DELETE', path: 'signups' | 'check-in', body: Record<string, unknown> = {}) {
    setTarget(playerId);
    return run(async () => {
      const res = await sendJsonRequest<{ nightRemoved?: boolean } | null>(method, `/api/scrims/${nightId}/${path}`, { player_id: playerId, ...body });
      startTransition(() => (res?.nightRemoved ? router.push('/scrims') : router.refresh()));
    });
  }

  return {
    busy,
    error,
    pending: busy ? target : null,
    setCommitment: (playerId: number, commitment: ScrimCommitment | null) =>
      commitment ? send(playerId, 'POST', 'signups', { commitment }) : send(playerId, 'DELETE', 'signups'),
    setCheckIn: (playerId: number, checkedIn: boolean) => send(playerId, checkedIn ? 'POST' : 'DELETE', 'check-in'),
  };
}
