'use client';

// In-match server panel (Phase 4). Once the 5-stage veto completes, this drives the hosting UX:
//   idle → (provision) → "Starting server…" spinner → Join + copy-`connect` → hidden on teardown.
//
// Updates via Supabase Realtime on the `matches` row (no polling) — the same channel pattern as
// VetoSequence; the table is already in the realtime publication. The moment the row flips to `live`
// we swap the spinner for the Join button.

import { useCallback, useEffect, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase-browser';
import type { ServerState } from '@/lib/dathost-lifecycle';
import { ServerSpinner } from '@/components/ServerSpinner';

interface StatusResponse {
  serverState: ServerState;
  connectString: string | null; // `ip:port`
}

export default function MatchServerPanel({
  matchId,
  canManage,
  autoProvisioning,
}: {
  matchId: number;
  canManage: boolean;
  /** Veto just completed, so a server provision is imminent (fired server-side in `after()`) —
   *  show the spinner immediately instead of racing the idle state against the Realtime update. */
  autoProvisioning?: boolean;
}) {
  const [state, setState] = useState<ServerState>('idle');
  const [connect, setConnect] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((s: ServerState, conn: string | null) => {
    setState(s);
    setConnect(conn);
  }, []);

  // Initial read (Realtime only delivers subsequent changes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/server/status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as StatusResponse;
        if (!cancelled) apply(data.serverState, data.connectString);
      } catch {
        /* transient — Realtime will still deliver updates */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, apply]);

  // Live updates straight off the matches row — no polling.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel(`match-server-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          const row = payload.new as {
            server_state?: ServerState;
            connect_string?: string | null;
          };
          apply(row.server_state ?? 'idle', row.connect_string ?? null);
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [matchId, apply]);

  const provision = async () => {
    setBusy(true);
    setError(null);
    // Optimistic: show the spinner immediately, before Realtime confirms.
    setState('provisioning');
    try {
      const res = await fetch(`/api/matches/${matchId}/server/provision`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not start the server');
        // 409 = another match holds the shared server (#134). Not a failure — revert to idle so the
        // manager can retry once it frees up, instead of showing the "failed / Retry" state.
        setState(res.status === 409 ? 'idle' : 'failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const teardown = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/server/teardown`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not stop the server');
      } else {
        setState('done');
        setConnect(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyConnect = async () => {
    if (!connect) return;
    await navigator.clipboard.writeText(`connect ${connect}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Nothing to show once the server is torn down — except in dev, where it's always visible.
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev && (state === 'done' || state === 'tearing_down')) return null;

  return (
    <div className="lift-card rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-4 shadow-lg">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Match server</div>

      {state === 'idle' && autoProvisioning && <ServerSpinner label="Starting server…" />}

      {state === 'idle' && !autoProvisioning && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-text-secondary)]">No server running for this match.</span>
          {canManage && (
            <button
              onClick={provision}
              disabled={busy}
              className="rounded-md border border-green-500 bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start server'}
            </button>
          )}
        </div>
      )}

      {state === 'provisioning' && (
        // Spinner until the row flips to `live`, then we swap in the real Join button.
        <ServerSpinner label="Starting server…" />
      )}

      {state === 'live' && connect && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`steam://connect/${connect}`}
              className="rounded-md border border-green-500 bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-500"
            >
              Join server
            </a>
            <button
              onClick={copyConnect}
              className="rounded-md border border-[var(--color-border-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
            >
              {copied ? 'Copied!' : `Copy “connect ${connect}”`}
            </button>
          </div>
          {canManage && (
            <button
              onClick={teardown}
              disabled={busy}
              className="self-start text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {busy ? 'Stopping…' : 'Stop server'}
            </button>
          )}
        </div>
      )}

      {state === 'failed' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-red-300">Server failed to start.</span>
          {canManage && (
            <button
              onClick={provision}
              disabled={busy}
              className="rounded-md border border-[var(--color-border-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
    </div>
  );
}
