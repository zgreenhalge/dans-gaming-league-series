'use client';

// In-match demo review block (Phase 3, manual confirm). After a demo is auto-parsed by the
// demo-ingest Action, this shows the staged result and lets an admin/in-match player confirm it
// (→ existing PATCH /score) or dismiss it. Self-hides when there's nothing staged. Auto-commit is #138.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DemoIngestResult } from '@/lib/demo/ingestResult';

interface ResultResponse {
  status: string | null; // background_jobs status
  result: DemoIngestResult | null;
}

const IN_PROGRESS = new Set(['received', 'queued', 'running']);

export default function MatchDemoReviewBlock({ matchId }: { matchId: number }) {
  const router = useRouter();
  const [data, setData] = useState<ResultResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll only while the Action is in flight (no staged result yet).
  useEffect(() => {
    const inProgress = !!data && data.result === null && !!data.status && IN_PROGRESS.has(data.status);
    if (inProgress && !pollRef.current) {
      pollRef.current = setInterval(refresh, 8000);
    } else if (!inProgress && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [data, refresh]);

  const dispose = async (disposition: 'confirmed' | 'dismissed') => {
    await fetch(`/api/matches/${matchId}/demo/result?disposition=${disposition}`, { method: 'DELETE' }).catch(() => {});
  };

  const confirm = async () => {
    if (!data?.result?.payload) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/score`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data.result.payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not save the score');
        return;
      }
      await dispose('confirmed');
      setData(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    await dispose('dismissed');
    setData(null);
    setBusy(false);
  };

  if (!data) return null;
  const { status, result } = data;

  // Parsing in flight.
  if (!result && status && IN_PROGRESS.has(status)) {
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
          onClick={confirm}
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
