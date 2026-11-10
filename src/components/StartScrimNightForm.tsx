'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ErrorText from './ErrorText';
import { SELECT_CLS } from './formStyles';
import { ADMIN_SMALL_AMBER_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { scrimNightHref } from '@/lib/crumbs';
import { SCRIM_START_STEP_MINUTES, type ScrimCommitment } from '@/lib/scrim-schedule';
import SectionLabel from './SectionLabel';

/** Starts a scrim night on `day` (`YYYY-MM-DD`, the viewer's own calendar day) at a time they pick in
 *  `SCRIM_START_STEP_MINUTES` steps, with them as its first signup, then opens its page. */
export function StartScrimNightForm({ playerId, day }: { playerId: number; day: string }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [, startTransition] = useTransition();
  const [time, setTime] = useState('20:00');

  const start = (commitment: ScrimCommitment) =>
    run(async () => {
      // A date and time with no zone: `new Date()` reads it as the browser's local time.
      const startsAt = new Date(`${day}T${time}`).toISOString();
      const res = await sendJsonRequest<{ nightId: number }>('POST', '/api/scrims', { player_id: playerId, startsAt, commitment });
      startTransition(() => router.push(scrimNightHref(res.nightId)));
    });

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-4 flex flex-col gap-2">
      <SectionLabel>Start a night this day</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="time"
          step={SCRIM_START_STEP_MINUTES * 60}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Night start time"
          className={SELECT_CLS}
        />
        <button type="button" onClick={() => start('definite')} disabled={busy || !time} className={`${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}>
          I&apos;m in
        </button>
        <button type="button" onClick={() => start('maybe')} disabled={busy || !time} className={`${ADMIN_SMALL_AMBER_BUTTON_CLS} disabled:opacity-40`}>
          Maybe
        </button>
      </div>
      <ErrorText error={error} size={12} />
    </div>
  );
}
