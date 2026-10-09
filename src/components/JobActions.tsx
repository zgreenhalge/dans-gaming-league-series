'use client';

// Client islands for the admin background-jobs dashboard (#145). The dashboard page stays a server
// component; these are the interactive bits. Demo-ingest rows keep their richer confirm/dismiss/
// re-parse actions via `IngestJobActions` (over `useDemoIngestActions`); replay and radar rows only
// need a re-dispatch, handled here by the generic `JobRetryButton`.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVisibleInterval } from '@/components/useVisibleInterval';

const ADMIN_REFRESH_INTERVAL_MS = 15_000;

/**
 * Re-dispatch a job by POSTing to its pipeline's dispatch endpoint (replay: the match's
 * `/replay/dispatch`, radar: the map's `/radar/dispatch`). Both endpoints guard against an
 * in-flight job, so this is safe to press; `inProgress` just disables it while one is working.
 */
export function JobRetryButton({
  dispatchUrl,
  inProgress,
  label = 'Retry',
}: {
  dispatchUrl: string;
  inProgress: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (inProgress) {
    return <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">working…</span>;
  }

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(dispatchUrl, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not start the job');
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={retry}
        disabled={busy}
        className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-50"
      >
        {busy ? '…' : label}
      </button>
      {error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{error}</span>}
    </div>
  );
}

/** Re-renders the admin dashboard every 15s while the tab is visible, and as soon as a hidden tab
 *  comes back, so `background_jobs` and `match_server_state` changes show up without a manual
 *  reload. Each refresh re-runs every query behind the page, so a hidden tab never refreshes. Admin
 *  views poll rather than subscribe to Realtime so they don't depend on the anon read access that
 *  exists for the match pages. Renders nothing. */
export function JobsLiveRefresh() {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useVisibleInterval(refresh, ADMIN_REFRESH_INTERVAL_MS);
  return null;
}
