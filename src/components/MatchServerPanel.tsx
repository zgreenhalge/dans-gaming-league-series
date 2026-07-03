'use client';

// In-match server panel (Phase 4). Once the 5-stage veto completes, this drives the hosting UX:
//   idle → (provision) → "Starting server.. 8s" progress fill → Join + copy-`connect` → hidden on teardown.
//
// Updates via Supabase Realtime on the `matches` row (no polling) — the same channel pattern as
// VetoSequence; the table is already in the realtime publication. The fill is an *estimate* against
// the observed ~20s boot; the moment the row flips to `live` we jump straight to the Join button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserClient } from '@/lib/supabase-browser';
import type { ServerState } from '@/lib/dathost-lifecycle';

interface StatusResponse {
  serverState: ServerState;
  connectString: string | null; // `ip:port`
  serverStartedAt: string | null;
}

const EST_BOOT_MS = 20_000; // observed boot time from the live probe

export default function MatchServerPanel({
  matchId,
  canManage,
}: {
  matchId: number;
  canManage: boolean;
}) {
  const [state, setState] = useState<ServerState>('idle');
  const [connect, setConnect] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelStartRef = useRef<number | null>(null);

  const apply = useCallback((s: ServerState, conn: string | null, startedAt: string | null) => {
    setState(s);
    setConnect(conn);
    setStartedAtMs(startedAt ? new Date(startedAt).getTime() : channelStartRef.current);
  }, []);

  // Initial read (Realtime only delivers subsequent changes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/matches/${matchId}/server/status`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as StatusResponse;
        if (!cancelled) apply(data.serverState, data.connectString, data.serverStartedAt);
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
            server_started_at?: string | null;
          };
          apply(row.server_state ?? 'idle', row.connect_string ?? null, row.server_started_at ?? null);
        },
      )
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [matchId, apply]);

  // Tick the elapsed clock only while provisioning (drives the fill + the "..8s" counter).
  useEffect(() => {
    if (state !== 'provisioning') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [state]);

  const provision = async () => {
    setBusy(true);
    setError(null);
    // Optimistic: show the progress fill immediately, before Realtime confirms.
    channelStartRef.current = Date.now();
    setStartedAtMs(Date.now());
    setNow(Date.now());
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

  const elapsedMs = startedAtMs ? Math.max(0, now - startedAtMs) : 0;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  // Cap the estimate-based fill at 92% so it never looks "done" while we're still waiting.
  const fillPct = Math.min(92, (elapsedMs / EST_BOOT_MS) * 100);

  return (
    <div className="lift-card rounded-lg border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] p-4 shadow-lg">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Match server</div>

      {state === 'idle' && (
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
        // Button-shaped progress fill — fills toward Join over the estimated boot, then we swap in
        // the real Join button the instant the row flips to `live`.
        <div className="relative h-9 w-full overflow-hidden rounded-md border border-green-500/70 bg-green-600/10">
          <div
            className="absolute inset-y-0 left-0 bg-green-600/40 transition-[width] duration-200 ease-linear"
            style={{ width: `${fillPct}%` }}
          />
          <span className="relative flex h-full items-center justify-center text-sm font-semibold text-[var(--color-text-primary)]">
            Starting server.. {elapsedSec}s
          </span>
        </div>
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
