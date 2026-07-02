'use client';

// Client islands for the admin ingestion dashboard (#136). Per-row actions (confirm / re-parse /
// dismiss) over the shared `useDemoIngestActions` hook, plus a Realtime refresher so the list stays
// live. The dashboard page stays a server component; these are the only interactive bits.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';
import { DEMO_INGEST_JOB_TYPE, DEMO_INGEST_IN_PROGRESS } from '@/lib/demo/ingestResult';
import { useDemoIngestActions } from './useDemoIngestActions';

export function IngestJobActions({
  matchId,
  status,
  hasPayload,
}: {
  matchId: number;
  status: string;
  hasPayload: boolean;
}) {
  const router = useRouter();
  const { confirm, dismiss, retry, busy, error } = useDemoIngestActions(matchId, {
    onSuccess: () => router.refresh(),
  });

  // Nothing to act on while the Action is still working.
  if (DEMO_INGEST_IN_PROGRESS.has(status)) {
    return <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">working…</span>;
  }

  // Confirm only a cleanly parsed, score-derived result. Quarantined (status !== 'parsed') and
  // side-unknown (no payload) go through re-parse / manual entry instead.
  const canConfirm = status === 'parsed' && hasPayload;
  const canDismiss = status === 'parsed' || status === 'quarantined';

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {canConfirm && (
          <button
            onClick={() => confirm()}
            disabled={busy}
            className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] disabled:opacity-50"
          >
            {busy ? '…' : 'Confirm'}
          </button>
        )}
        <button
          onClick={() => retry()}
          disabled={busy}
          className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          Re-parse
        </button>
        {canDismiss && (
          <button
            onClick={() => dismiss()}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            Dismiss
          </button>
        )}
      </div>
      {error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>}
    </div>
  );
}

/** Refreshes the dashboard when any `demo_ingest` job row changes. Renders nothing. */
export function IngestLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const channel = getBrowserClient()
      .channel('admin-ingestion')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'background_jobs' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { job_type?: string } | null;
          if (row?.job_type === DEMO_INGEST_JOB_TYPE) router.refresh();
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [router]);
  return null;
}
