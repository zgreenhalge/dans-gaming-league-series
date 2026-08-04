'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useAsyncAction } from './useAsyncAction';

interface Props {
  seasonId: number;
  canEdit: boolean;
  seasonStatus: string;
}

/** Admin control to transition a regular season UPCOMING -> ACTIVE ("go live"), shown next to
 * SeasonStartDateButton. Going live also best-effort builds the season's gauntlet bracket shape
 * (server-side, via activateSeason()) — there's no undo in the UI, so this arms before firing. If
 * that build fails, the PATCH response says so (`gauntletBuilt`/`gauntletBuildError`) and this
 * shows it as a persistent warning rather than just logging it server-side — activation itself
 * still succeeds, so the warning is the only place the failure is visible afterward. */
export default function MarkSeasonActiveButton({ seasonId, canEdit, seasonStatus }: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const { busy, error, run } = useAsyncAction();
  const [warning, setWarning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function activate() {
    await run(async () => {
      const res = await fetch(`/api/seasons/${seasonId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArmed(false);
        throw new Error(body.error ?? 'Failed to activate season.');
      }
      if (body.gauntletBuilt === false) {
        setWarning(`Season is live, but its gauntlet bracket wasn't built: ${body.gauntletBuildError}`);
      }
      startTransition(() => router.refresh());
    });
  }

  // Keep showing the warning even after refresh flips seasonStatus away from UPCOMING — it's the
  // only place this failure is visible, since activation itself succeeded.
  if (warning) {
    return (
      <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] max-w-[420px]">
        {warning}
      </div>
    );
  }

  if (!canEdit || seasonStatus !== 'UPCOMING') return null;

  return (
    <ArmedConfirmButton
      armed={armed}
      onArm={() => setArmed(true)}
      onCancel={() => setArmed(false)}
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
