'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to activate season.');
        setArmed(false);
        return;
      }
      if (body.gauntletBuilt === false) {
        setWarning(`Season is live, but its gauntlet bracket wasn't built: ${body.gauntletBuildError}`);
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
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
    <div className="flex items-center gap-2">
      {armed ? (
        <>
          <button
            onClick={activate}
            disabled={busy}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] hover:brightness-110 transition-all disabled:opacity-40"
          >
            {busy ? 'Activating…' : 'Confirm Go Live'}
          </button>
          <button
            onClick={() => setArmed(false)}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setArmed(true)}
          className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
        >
          Mark Active
        </button>
      )}
      {error && <div className="text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </div>
  );
}
