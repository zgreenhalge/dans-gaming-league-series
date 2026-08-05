'use client';

// Per-match "reparse demo" trigger — re-dispatches the demo-ingest Action against the demo already in
// R2 (POST /demo/dispatch). For an already-scored match whose derived score is unchanged, the Action
// applies the refreshed sabremetrics automatically; a changed score instead stages the normal review
// on the match page. Mirrors FeatureMatchToggle's self-contained fetch pattern.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';

export function ReparseDemoButton({ matchId }: { matchId: number }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  const [queued, setQueued] = useState(false);

  async function reparse() {
    await run(async () => {
      const res = await fetch(`/api/matches/${matchId}/demo/dispatch`, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Failed to dispatch');
      }
      setQueued(true);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={reparse}
        disabled={busy}
        className="font-mono text-[11px] px-2.5 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {busy ? '…' : queued ? 'queued ↻' : 'reparse demo'}
      </button>
      {error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>}
    </div>
  );
}
