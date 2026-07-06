'use client';

// Admin "recompute EHOG ratings now" control (#144). Fires `POST /api/ehog/recompute/trigger`, which
// kicks off a full rating walk in the background. Ratings already recompute on every score write, so
// this is a manual force — the button reports that it started, not when the walk finishes.

import { useState } from 'react';

type State = 'idle' | 'running' | 'started' | 'error';

export function RecomputeButton() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setState('running');
    setError(null);
    try {
      const res = await fetch('/api/ehog/recompute/trigger', { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Failed to start recompute');
        setState('error');
        return;
      }
      setState('started');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={trigger}
          disabled={state === 'running'}
          className="font-mono text-[11px] px-2.5 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
        >
          {state === 'running' ? 'starting…' : 'Recompute now'}
        </button>
        {state === 'started' && (
          <span className="font-mono text-[10px] text-[var(--color-accent-green-fg)]">recompute started — runs in the background</span>
        )}
        {state === 'error' && error && (
          <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>
        )}
      </div>
      <div className="font-mono text-[10px] text-[var(--color-text-secondary)]">
        Ratings already recompute automatically on every score write — this forces a full walk now.
      </div>
    </div>
  );
}
