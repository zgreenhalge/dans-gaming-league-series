'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocalTime } from './LocalTime';
import { JobRetryButton } from './JobActions';

export interface OpsErrorItem {
  id: number;
  entityType: 'season' | 'match' | 'player' | 'system';
  entityId: number;
  label: string;
  operation: string;
  message: string;
  occurredAt: string;
}

/**
 * The endpoint that re-attempts a row's failed operation, for operations that have a safe,
 * idempotent, no-extra-input retry path — `null` means dismiss is the only available action.
 * Deliberately narrow: an operation only belongs here once its retry is confirmed safe to fire
 * blind against a row that may be stale by the time an admin clicks it, not just because *a*
 * related endpoint happens to exist.
 *
 * `server_teardown` is deliberately excluded: its explicit-teardown route stops the shared match
 * server unconditionally (no `onlyIfOwnsServer` guard — see `teardownMatchServer()`'s doc comment
 * in `dathost-lifecycle.ts`), since it's built for a human admin looking at the *current* server
 * state, not for retrying a possibly-stale failure that could now belong to a different match.
 */
export function retryEndpointFor(item: Pick<OpsErrorItem, 'operation' | 'entityId'>): string | null {
  switch (item.operation) {
    case 'ehog_recompute':
      return '/api/ehog/recompute/trigger';
    case 'server_provision':
      return `/api/matches/${item.entityId}/server/provision`;
    case 'discord_schedule_reminder':
    case 'discord_notify_reminder':
      return `/api/matches/${item.entityId}/schedule/retry-reminder`;
    default:
      return null;
  }
}

export const OPERATION_LABELS: Record<string, string> = {
  gauntlet_build: 'Gauntlet Build',
  gauntlet_seed: 'Gauntlet Seed',
  gauntlet_archive: 'Gauntlet Archive',
  gauntlet_delete: 'Gauntlet Delete',
  gauntlet_manual_save: 'Gauntlet Manual Save',
  steam_id_learn: 'Steam ID Learning',
  server_provision: 'Server Provision',
  server_teardown: 'Server Teardown',
  sabremetrics_persist: 'Sabremetrics',
  weapon_stats_persist: 'Weapon Stats',
  live_score_clear: 'Live Score Clear',
  name_history_log: 'Name History Log',
  ehog_recompute: 'EHOG Recompute',
  schedule_generate: 'Schedule Generate',
  schedule_generate_cleanup: 'Schedule Generate Cleanup',
  schedule_confirm: 'Schedule Confirm',
  schedule_confirm_cleanup: 'Schedule Confirm Cleanup',
};

/** Dismiss one live `ops_errors` row. Shared by every surface that renders one (this list, and the
 * Activity feed's merged Errored tier) so the request/response handling can't drift between them. */
export async function dismissOpsError(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/ops-errors/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error ?? 'Failed to dismiss.' };
  }
  return { ok: true };
}

function OpsErrorRow({ item }: { item: OpsErrorItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryUrl = retryEndpointFor(item);

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      const result = await dismissOpsError(item.id);
      if (!result.ok) {
        setError(result.error);
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
        <div className="flex items-center gap-2 shrink-0">
          {retryUrl && <JobRetryButton dispatchUrl={retryUrl} inProgress={false} />}
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
    </div>
  );
}

/** Surfaces live `ops_errors` rows — best-effort operations (gauntlet build/seed/archive/manual
 * save, steam-id learning, server provisioning/teardown, sabremetrics/weapon stats, name history
 * logging, EHOG recompute, schedule generate/confirm) that failed or need admin attention.
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
