'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';

/** Manual "go live" for a regular season, UPCOMING -> ACTIVE. Confirming a season's matchup draft
 * already does this automatically (`activateSeasonBestEffort()`, deferred off
 * `POST /api/seasons/[id]/schedule/confirm`); this only matters when that auto-trigger's own status
 * write failed (recorded as a `season_activate` ops error), leaving the season stuck on `UPCOMING`.
 * Going live also best-effort builds the season's gauntlet bracket shape (server-side, via
 * `activateSeason()`). If that build fails, the PATCH response says so
 * (`gauntletBuilt`/`gauntletBuildError`) and `warning` carries it, for the caller to keep showing:
 * activation itself still succeeds, so the warning is the only place the failure is visible. */
export function useActivateSeason(seasonId: number) {
  const router = useRouter();
  const { busy: writing, error, run } = useAsyncAction();
  const [warning, setWarning] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();

  function activate() {
    return run(async () => {
      const body = await sendJsonRequest<{ gauntletBuilt?: boolean; gauntletBuildError?: string } | null>(
        'PATCH',
        `/api/seasons/${seasonId}/status`,
        { status: 'ACTIVE' },
      );
      if (body?.gauntletBuilt === false) {
        setWarning(`Season is live, but its gauntlet bracket wasn't built: ${body.gauntletBuildError}`);
      }
      startTransition(() => router.refresh());
    });
  }

  // Busy through the refresh after a write too: the season reads UPCOMING until it lands.
  return { activate, busy: writing || refreshing, error, warning };
}

/** The amber line for `useActivateSeason()`'s `warning`. */
export function ActivationWarning({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] max-w-[420px]">{warning}</div>;
}
