'use client';

// Admin server console (#134/#135, admin console b). Central view of the single shared DatHost
// server: who holds it right now, the connect string, and a Teardown control for a server left
// live (e.g. autostop failed). Stays live via Realtime on `matches`. The per-match MatchServerPanel
// still handles provisioning on the match page; this is the global operator view + safety valve.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';
import { fmtUtcShort } from '@/lib/util';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';

export function ServerConsolePanel({ active }: { active: ActiveServerMatch | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the console live — any match-row change (provision/teardown/reconcile) re-renders it.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel('admin-servers')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => router.refresh())
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [router]);

  const teardown = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${active.matchId}/server/teardown`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not stop the server');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!active) {
    return (
      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-6 font-mono text-[13px] text-[var(--color-text-secondary)]">
        Shared server is <span className="text-[var(--color-accent-green-fg)]">idle</span> — no match is holding it.
      </div>
    );
  }

  const since = fmtUtcShort(active.serverStartedAt);
  return (
    <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            Shared server ·{' '}
            <span className="text-[var(--color-accent-amber-fg)]">{active.serverState}</span>
          </div>
          <Link href={`/matches/${active.matchId}`} className="font-display text-[16px] font-semibold hover:underline">
            {active.label}
          </Link>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1 flex flex-wrap gap-x-3">
            {active.connectString && <span>connect {active.connectString}</span>}
            {since && <span>since {since}</span>}
          </div>
        </div>
        <button
          onClick={teardown}
          disabled={busy}
          className="shrink-0 font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] disabled:opacity-50"
        >
          {busy ? 'Stopping…' : 'Tear down'}
        </button>
      </div>
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-2">{error}</div>}
    </div>
  );
}
