'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';

interface Props {
  seasonId: number;
  seasonStatus: string;
}

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
  const { busy, error, run } = useAsyncAction();
  const [warning, setWarning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  return { activate, busy, error, warning };
}

/** The amber line for `useActivateSeason()`'s `warning`. */
export function ActivationWarning({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] max-w-[420px]">{warning}</div>;
}

/** `useActivateSeason()` as a button that arms before firing (there's no undo in the UI), for the
 * admin console's season list. The season page puts the same action in its admin menu
 * (`SeasonSetupDetails`). */
export default function MarkSeasonActiveButton({ seasonId, seasonStatus }: Props) {
  const { activate, busy, error, warning } = useActivateSeason(seasonId);

  // Keep showing the warning even after refresh flips seasonStatus away from UPCOMING — it's the
  // only place this failure is visible, since activation itself succeeded.
  if (warning) return <ActivationWarning warning={warning} />;
  if (seasonStatus !== 'UPCOMING') return null;

  return (
    <ArmedConfirmButton
      onConfirm={activate}
      busy={busy}
      error={error}
      triggerLabel="Mark Active"
      confirmLabel="Confirm Go Live"
      busyLabel="Activating…"
      variant="primary"
    />
  );
}
