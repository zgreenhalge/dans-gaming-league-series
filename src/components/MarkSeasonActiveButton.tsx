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
 * (server-side, via activateSeason()) — there's no undo in the UI, so this arms before firing. */
export default function MarkSeasonActiveButton({ seasonId, canEdit, seasonStatus }: Props) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (!canEdit || seasonStatus !== 'UPCOMING') return null;

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to activate season.');
        setArmed(false);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

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
