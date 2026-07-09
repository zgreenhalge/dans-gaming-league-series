'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface GauntletRow {
  regularSeasonId: number;
  regularSeasonName: string;
  gauntletName: string;
  started: boolean;
}

function GauntletResetRow({ season }: { season: GauntletRow }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${season.regularSeasonId}/gauntlet`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to reset gauntlet.');
        setArmed(false);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <div>
        <div className="font-display text-[14px] font-semibold">{season.gauntletName}</div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          {season.regularSeasonName} — {season.started ? 'in progress' : 'round 1 not yet played'}
        </div>
        {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1">{error}</div>}
      </div>

      {season.started ? (
        <span className="tracked text-[9px] text-[var(--color-text-secondary)]">Cannot reset</span>
      ) : armed ? (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] hover:brightness-110 transition-all disabled:opacity-40"
          >
            {busy ? 'Resetting…' : 'Confirm Reset'}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors shrink-0"
        >
          Reset
        </button>
      )}
    </div>
  );
}

/** Lists active seasons that already have a gauntlet, with a reset action for any gauntlet that
 * hasn't had a match scored yet — deletes the gauntlet season and everything materialized under it
 * so its bracket can be rebuilt from scratch. Mainly for shaking out bracket-generation bugs
 * without leaving test seasons behind. */
export function ResetGauntletList({ seasons }: { seasons: GauntletRow[] }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {seasons.map((s) => (
        <GauntletResetRow key={s.regularSeasonId} season={s} />
      ))}
    </div>
  );
}
