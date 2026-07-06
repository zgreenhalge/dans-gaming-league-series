'use client';

// Per-row demo-ingest actions for the admin jobs dashboard (#136 / #145): confirm / re-parse /
// dismiss over the shared `useDemoIngestActions` hook. The dashboard page stays a server component;
// this is the interactive bit for demo rows (replay/radar rows use `JobRetryButton`).

import { useRouter } from 'next/navigation';
import { DEMO_INGEST_IN_PROGRESS } from '@/lib/demo/ingestResult';
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
            className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-border)] transition-colors disabled:opacity-50"
          >
            {busy ? '…' : 'Confirm'}
          </button>
        )}
        <button
          onClick={() => retry()}
          disabled={busy}
          className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-50"
        >
          Re-parse
        </button>
        {canDismiss && (
          <button
            onClick={() => dismiss()}
            disabled={busy}
            title="Dismiss"
            aria-label="Dismiss"
            className="font-mono text-[13px] leading-none text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors disabled:opacity-50"
          >
            ✕
          </button>
        )}
      </div>
      {error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>}
    </div>
  );
}
