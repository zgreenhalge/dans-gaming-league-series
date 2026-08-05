'use client';

// Admin control to flip a match's `is_feature_match` flag via `PATCH /feature` (#144). Standalone so
// it can sit on the match console now and the match page later without duplication.

import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';

export function FeatureMatchToggle({ matchId, isFeature }: { matchId: number; isFeature: boolean }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();

  async function toggle() {
    await run(async () => {
      const res = await fetch(`/api/matches/${matchId}/feature`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_feature_match: !isFeature }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Failed to update');
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={isFeature}
        className={`font-mono text-[11px] px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${
          isFeature
            ? 'border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)]'
            : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        {busy ? '…' : isFeature ? '★ feature match' : '☆ not featured'}
      </button>
      {error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>}
    </div>
  );
}
