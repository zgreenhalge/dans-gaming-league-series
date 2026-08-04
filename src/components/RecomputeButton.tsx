'use client';

// Admin "recompute EHOG ratings now" control (#144). Fires `POST /api/ehog/recompute/trigger`, which
// kicks off a full rating walk in the background. Ratings already recompute on every score write, so
// this is a manual force — the button reports that it started, not when the walk finishes.

import { useState } from 'react';
import { useAsyncAction } from './useAsyncAction';

export function RecomputeButton() {
  const { busy, error, run } = useAsyncAction();
  const [started, setStarted] = useState(false);

  async function trigger() {
    setStarted(false);
    await run(async () => {
      const res = await fetch('/api/ehog/recompute/trigger', { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Failed to start recompute');
      }
      setStarted(true);
    });
  }

  return (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={trigger}
        disabled={busy}
        className="font-mono text-[11px] px-2.5 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
      >
        {busy ? 'starting…' : 'Recompute all EHOGs'}
      </button>
      {started && !error && (
        <span className="font-mono text-[10px] text-[var(--color-accent-green-fg)]">recompute started — runs in the background</span>
      )}
      {error && (
        <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>
      )}
    </div>
  );
}
