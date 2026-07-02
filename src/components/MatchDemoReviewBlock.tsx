'use client';

// In-match demo review block (Phase 3, manual confirm). After a demo is auto-parsed by the
// demo-ingest Action, this shows the staged result and lets an admin/in-match player confirm it
// (→ existing PATCH /score) or dismiss it. Self-hides when there's nothing staged. Auto-commit is #138.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';
import {
  DEMO_INGEST_JOB_TYPE,
  DEMO_INGEST_IN_PROGRESS,
  type DemoIngestResult,
} from '@/lib/demo/ingestResult';
import { useDemoIngestActions } from './useDemoIngestActions';

interface ResultResponse {
  status: string | null; // background_jobs status
  result: DemoIngestResult | null;
  resultError?: string; // set when the staged artifact exists but couldn't be read
}

export default function MatchDemoReviewBlock({ matchId }: { matchId: number }) {
  const router = useRouter();
  const [data, setData] = useState<ResultResponse | null>(null);
  const { confirm, dismiss, busy, error } = useDemoIngestActions(matchId, {
    onSuccess: () => {
      setData(null);
      router.refresh();
    },
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}/demo/result`);
      if (!res.ok) return;
      setData((await res.json()) as ResultResponse);
    } catch {
      /* transient */
    }
  }, [matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Live updates off the `background_jobs` row — no polling. Mirrors MatchServerPanel's pattern on
  // `matches`. Requires `background_jobs` in the Supabase realtime publication. Each status change
  // (received → queued → running → parsed/quarantined/failed) re-reads the staged result.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel(`demo-ingest-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'background_jobs', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { job_type?: string } | null;
          if (row?.job_type === DEMO_INGEST_JOB_TYPE) refresh();
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [matchId, refresh]);

  if (!data) return null;
  const { status, result } = data;

  // Parsing in flight.
  if (!result && status && DEMO_INGEST_IN_PROGRESS.has(status)) {
    return (
      <Card>
        <Header />
        <div className="flex items-center gap-3 text-sm text-[var(--color-text-primary)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border-primary)] border-t-[var(--color-text-primary)]" />
          Parsing demo…
        </div>
      </Card>
    );
  }

  // Parse failed, or the staged artifact is unreadable — surface it instead of rendering nothing.
  if (!result && (status === 'failed' || data.resultError)) {
    return (
      <Card>
        <Header />
        <div className="text-sm text-red-300">
          {data.resultError ?? 'Demo parsing failed — enter the result manually.'}
        </div>
        <DismissLink onClick={dismiss} busy={busy} />
      </Card>
    );
  }

  if (!result) return null;

  // Quarantined — don't offer one-click confirm.
  if (result.quarantined) {
    return (
      <Card>
        <Header />
        <div className="text-sm text-amber-300">Demo flagged for manual review:</div>
        <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-text-secondary)]">
          {result.quarantineFlags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
        <DismissLink onClick={dismiss} busy={busy} />
      </Card>
    );
  }

  // Score couldn't be derived (unknown side → gauntlet/knife): route to manual entry.
  if (!result.payload) {
    return (
      <Card>
        <Header />
        <div className="text-sm text-[var(--color-text-secondary)]">
          Demo parsed, but the starting side is unknown so the score wasn’t derived — set the side and
          enter the result manually.
        </div>
        <DismissLink onClick={dismiss} busy={busy} />
      </Card>
    );
  }

  // Confirm-ready.
  const { shirts, skins } = result.payload;
  return (
    <Card>
      <Header />
      <div className="flex items-baseline gap-2 text-sm text-[var(--color-text-primary)]">
        Demo parsed —{' '}
        <span className="font-display text-lg font-bold">
          Shirts {shirts} – {skins} Skins
        </span>
      </div>
      {result.warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs text-amber-300">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => confirm(result.payload, result.warnings)}
          disabled={busy}
          className="rounded-md border border-green-500 bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Confirm result'}
        </button>
        <button
          onClick={dismiss}
          disabled={busy}
          className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="lift-card rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-4 shadow-lg">
      {children}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
      Demo result
    </div>
  );
}

function DismissLink({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-3 text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)] disabled:opacity-50"
    >
      Dismiss
    </button>
  );
}
