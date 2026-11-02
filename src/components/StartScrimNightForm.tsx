'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ErrorText from './ErrorText';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_AMBER_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { scrimNightHref } from '@/lib/crumbs';
import type { ScrimCommitment } from '@/lib/scrim-schedule';

const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

/** Starts a scrim night at a date and time the viewer picks (in their own timezone), with them as its
 *  first signup, then opens its page. */
export function StartScrimNightForm({ playerId }: { playerId: number }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const [when, setWhen] = useState('');

  const start = (commitment: ScrimCommitment) =>
    run(async () => {
      // A `datetime-local` value has no zone; `new Date()` reads it as the browser's local time.
      const startsAt = new Date(when).toISOString();
      const res = await sendJsonRequest<{ nightId: number }>('POST', '/api/scrims', { player_id: playerId, startsAt, commitment });
      startTransition(() => router.push(scrimNightHref(res.nightId)));
    });

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-4 flex flex-col gap-2">
      <div className={LABEL_CLS}>Start a night</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="Night start"
          className={SELECT_CLS}
        />
        <button type="button" onClick={() => start('definite')} disabled={busy || !when} className={`${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}>
          I&apos;m in
        </button>
        <button type="button" onClick={() => start('maybe')} disabled={busy || !when} className={`${ADMIN_SMALL_AMBER_BUTTON_CLS} disabled:opacity-40`}>
          Maybe
        </button>
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
        You&apos;ll be its first signup. A night is removed if everyone drops out.
      </div>
      <ErrorText error={error} size={12} />
    </div>
  );
}
