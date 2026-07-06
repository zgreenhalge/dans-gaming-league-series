'use client';

// Client islands for the admin background-jobs dashboard (#145). The dashboard page stays a server
// component; these are the interactive bits. Demo-ingest rows keep their richer confirm/dismiss/
// re-parse actions via `IngestJobActions` (over `useDemoIngestActions`); replay and radar rows only
// need a re-dispatch, handled here by the generic `JobRetryButton`.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';

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

/** Refreshes the dashboard when any `background_jobs` row changes, across every job type. Renders nothing. */
export function JobsLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const channel = getBrowserClient()
      .channel('admin-jobs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'background_jobs' },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [router]);
  return null;
}
