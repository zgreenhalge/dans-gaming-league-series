'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface OpsErrorSeason {
  id: number;
  name: string;
  isGauntlet: boolean;
  opsError: string;
  opsErrorAt: string | null;
}

function OpsErrorRow({ season }: { season: OpsErrorSeason }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch(`/api/seasons/${season.id}/ops-error`, { method: 'PATCH' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--color-accent-amber-border)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[14px] font-semibold">{season.name}</span>
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
              {season.isGauntlet ? 'Gauntlet' : 'Regular'}
            </span>
          </div>
          <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 max-w-[520px]">
            {season.opsError}
          </div>
          {season.opsErrorAt && (
            <div className="font-mono text-[10px] text-[var(--color-text-secondary)] mt-1">
              {new Date(season.opsErrorAt).toLocaleString()}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40 shrink-0"
        >
          {busy ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}

/** Surfaces seasons with a live `ops_error` — a best-effort gauntlet operation (auto-build,
 * auto-seed, auto-archive) that failed or needs admin attention. Each row can be dismissed once
 * the admin has seen it, or resolves itself the next time that same operation succeeds. */
export function OpsErrorList({ seasons }: { seasons: OpsErrorSeason[] }) {
  if (seasons.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="tracked text-[10px] text-[var(--color-accent-amber-fg)] mb-3">Attention Needed</div>
      <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)]">
        {seasons.map((s) => (
          <OpsErrorRow key={s.id} season={s} />
        ))}
      </div>
    </div>
  );
}
