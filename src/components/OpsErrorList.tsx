'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocalTime } from './LocalTime';

export interface OpsErrorItem {
  id: number;
  entityType: 'season' | 'match' | 'player' | 'system';
  label: string;
  operation: string;
  message: string;
  occurredAt: string;
}

const OPERATION_LABELS: Record<string, string> = {
  gauntlet_build: 'Gauntlet Build',
  gauntlet_seed: 'Gauntlet Seed',
  gauntlet_archive: 'Gauntlet Archive',
  steam_id_learn: 'Steam ID Learning',
  server_teardown: 'Server Teardown',
  sabremetrics_persist: 'Sabremetrics',
  name_history_log: 'Name History Log',
  ehog_recompute: 'EHOG Recompute',
};

function OpsErrorRow({ item }: { item: OpsErrorItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops-errors/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to dismiss.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--color-accent-amber-border)] last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[14px] font-semibold">{item.label}</span>
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
              {OPERATION_LABELS[item.operation] ?? item.operation}
            </span>
          </div>
          <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 max-w-[520px]">
            {item.message}
          </div>
          <div className="font-mono text-[10px] text-[var(--color-text-secondary)] mt-1">
            <LocalTime iso={item.occurredAt} />
          </div>
          {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1">{error}</div>}
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

/** Surfaces live `ops_errors` rows — best-effort operations (gauntlet build/seed/archive, steam-id
 * learning, server teardown, sabremetrics, name history logging, EHOG recompute) that failed or
 * need admin attention.
 * Each row can be dismissed once the admin has seen it, or resolves itself the next time that same
 * operation succeeds. Used both filtered to one entity type (the gauntlet admin page) and
 * unfiltered (the site-wide `/admin/ops-errors` console). */
export function OpsErrorList({ items, title = 'Attention Needed' }: { items: OpsErrorItem[]; title?: string }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="tracked text-[10px] text-[var(--color-accent-amber-fg)] mb-3">{title}</div>
      <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)]">
        {items.map((item) => (
          <OpsErrorRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
