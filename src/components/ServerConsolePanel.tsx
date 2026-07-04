'use client';

// Admin server console (#134/#135, admin console b — now server-centric). Three sections: match
// occupancy (who holds it right now + Teardown, for the autostop-failed safety valve), a combined
// panel below it — raw DatHost server state + start/stop + apply-a-config-set (map picker +
// config-set dropdown, settings only — doesn't start the server), and disk cleanup (issue #132) —
// enable/disable + interval + a manual "run now" for the dathost-cleanup GitHub Action. The
// per-match MatchServerPanel still handles per-match provisioning on the match page; this is the
// global operator view.
//
// Start/Stop/Apply are occupancy-checked server-side (getServerOccupancy) — a DGLS match holding the
// server, or live players on it with no DGLS match at all (casual/manual use), both refuse the action
// with a 409 unless `override: true`. On that refusal this component shows an inline confirm-or-cancel
// prompt rather than silently blocking or silently proceeding.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Check } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase-browser';
import { fmtUtcShort } from '@/lib/util';
import { toSentenceCase } from '@/lib/maps';
import { workshopIdFromUrl } from '@/lib/replay/radar';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';
import type { ConfigSetOption } from '@/lib/dathost';
import type { WorkshopMapOption } from '@/lib/queries';
import type { AdminServerStatus } from '@/app/api/admin/server/status/route';
import type { DathostCleanupStatus } from '@/app/api/admin/dathost-cleanup/status/route';

const CUSTOM_MAP_CHOICE = '__custom__';

type PendingAction = { kind: 'start' | 'stop' | 'apply'; message: string };

function StatePill({ configured, server }: { configured: boolean; server: AdminServerStatus['server'] }) {
  if (!configured) {
    return (
      <span className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
        hosting not configured
      </span>
    );
  }
  if (!server) {
    return (
      <span
        className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border"
        style={{
          backgroundColor: 'var(--color-accent-red-bg)',
          color: 'var(--color-accent-red-fg)',
          borderColor: 'var(--color-accent-red-border)',
        }}
      >
        unreachable
      </span>
    );
  }
  const label = server.booting ? 'booting' : server.on ? 'on' : 'off';
  const style =
    label === 'on'
      ? { bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' }
      : label === 'booting'
        ? { bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' }
        : { bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border-secondary)' };
  return (
    <span
      className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border"
      style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
    >
      {label}
    </span>
  );
}

function CopyConnectButton({ connect }: { connect: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(`connect ${connect}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={`Copy "connect ${connect}"`}
      className="inline-flex items-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function lastRunSummary(lastRun: DathostCleanupStatus['lastRun']): string {
  if (!lastRun) return 'never run';
  const when = fmtUtcShort(lastRun.createdAt);
  const outcome = lastRun.status === 'completed' ? (lastRun.conclusion ?? 'unknown') : lastRun.status;
  const trigger = lastRun.event === 'workflow_dispatch' ? 'manual' : lastRun.event;
  return `${outcome} · ${when} · ${trigger}`;
}

export function ServerConsolePanel({
  active: initialActive,
  configSets,
  maps,
}: {
  active: ActiveServerMatch | null;
  configSets: ConfigSetOption[];
  maps: WorkshopMapOption[];
}) {
  const router = useRouter();

  const [status, setStatus] = useState<AdminServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [startStopBusy, setStartStopBusy] = useState(false);
  const [startStopError, setStartStopError] = useState<string | null>(null);

  const [configSet, setConfigSet] = useState(configSets[0]?.key ?? '');
  const [mapChoice, setMapChoice] = useState('');
  const [customMapId, setCustomMapId] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const [teardownBusy, setTeardownBusy] = useState(false);
  const [teardownError, setTeardownError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/server/status');
      if (!res.ok) {
        setStatusError('Could not load server status');
        return;
      }
      setStatus((await res.json()) as AdminServerStatus);
      setStatusError(null);
    } catch {
      setStatusError('Could not load server status');
    }
  }, []);

  // Initial read — a plain effect calling refreshStatus() directly trips the
  // set-state-in-effect lint rule, so mirror MatchServerPanel's cancelled-IIFE pattern.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refreshStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  // Raw DatHost state can change with no `matches` row write at all (autostop after idle, a start/
  // stop from the DatHost panel directly) — poll so the console doesn't go stale between those.
  useEffect(() => {
    const interval = setInterval(refreshStatus, 15_000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Keep the console live — any match-row change (provision/teardown/reconcile) re-reads raw server
  // status; router.refresh() re-fetches this component's `active` prop for consistency, but the
  // occupancy section below prefers status.active (fresher, from the same fetch) once it's loaded.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel('admin-servers')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => {
        router.refresh();
        refreshStatus();
      })
      .subscribe();
    return () => {
      getBrowserClient().removeChannel(channel);
    };
  }, [router, refreshStatus]);

  const [cleanup, setCleanup] = useState<DathostCleanupStatus | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupToggleBusy, setCleanupToggleBusy] = useState(false);
  const [cleanupRunBusy, setCleanupRunBusy] = useState(false);
  const [cleanupRunMessage, setCleanupRunMessage] = useState<string | null>(null);
  const [intervalInput, setIntervalInput] = useState('');
  const [intervalBusy, setIntervalBusy] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);

  const refreshCleanup = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dathost-cleanup/status');
      if (!res.ok) {
        setCleanupError('Could not load cleanup status');
        return;
      }
      const data = (await res.json()) as DathostCleanupStatus;
      setCleanup(data);
      setCleanupError(data.error);
      setIntervalInput((prev) => (prev === '' ? String(data.intervalDays) : prev));
    } catch {
      setCleanupError('Could not load cleanup status');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refreshCleanup();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCleanup]);

  // Lower-frequency than the server-state poll — this only changes once a day at most.
  useEffect(() => {
    const interval = setInterval(refreshCleanup, 60_000);
    return () => clearInterval(interval);
  }, [refreshCleanup]);

  const toggleCleanupEnabled = async () => {
    if (!cleanup) return;
    setCleanupToggleBusy(true);
    setCleanupError(null);
    try {
      const res = await fetch('/api/admin/dathost-cleanup/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cleanup.enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCleanupError(body.error ?? 'Could not update cleanup schedule');
        return;
      }
      await refreshCleanup();
    } finally {
      setCleanupToggleBusy(false);
    }
  };

  const saveInterval = async () => {
    const days = Number(intervalInput);
    if (!Number.isInteger(days) || days < 1) return;
    setIntervalBusy(true);
    setIntervalSaved(false);
    setCleanupError(null);
    try {
      const res = await fetch('/api/admin/dathost-cleanup/interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCleanupError(body.error ?? 'Could not save interval');
        return;
      }
      setIntervalSaved(true);
      await refreshCleanup();
    } finally {
      setIntervalBusy(false);
    }
  };

  const runCleanupNow = async () => {
    setCleanupRunBusy(true);
    setCleanupRunMessage(null);
    setCleanupError(null);
    try {
      const res = await fetch('/api/admin/dathost-cleanup/run', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCleanupError(body.error ?? 'Could not trigger cleanup');
        return;
      }
      setCleanupRunMessage('Triggered — check the Actions log for progress.');
      // The new run won't show up in the status endpoint for a few seconds; one delayed refresh
      // is enough for an admin glancing back at this panel, no need to poll tightly for it.
      setTimeout(refreshCleanup, 5000);
    } finally {
      setCleanupRunBusy(false);
    }
  };

  const startServer = async (override = false) => {
    setStartStopBusy(true);
    setStartStopError(null);
    try {
      const res = await fetch('/api/admin/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'server_occupied' && !override) {
          setPending({ kind: 'start', message: body.error });
          return;
        }
        setStartStopError(body.error ?? 'Could not start the server');
        return;
      }
      setPending(null);
      await refreshStatus();
    } finally {
      setStartStopBusy(false);
    }
  };

  const stopServer = async (override = false) => {
    setStartStopBusy(true);
    setStartStopError(null);
    try {
      const res = await fetch('/api/admin/server/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'server_occupied' && !override) {
          setPending({ kind: 'stop', message: body.error });
          return;
        }
        setStartStopError(body.error ?? 'Could not stop the server');
        return;
      }
      setPending(null);
      await refreshStatus();
    } finally {
      setStartStopBusy(false);
    }
  };

  // Lenient: accepts a bare numeric ID or a full workshop URL (same parser used elsewhere for map
  // workshop URLs), so pasting either into the custom field just works.
  const resolvedMapId = mapChoice === CUSTOM_MAP_CHOICE ? workshopIdFromUrl(customMapId.trim()) : mapChoice || null;
  const customMapInvalid = mapChoice === CUSTOM_MAP_CHOICE && customMapId.trim() !== '' && !resolvedMapId;

  const applyConfig = async (override = false) => {
    if (!configSet || !resolvedMapId) return;
    setApplyBusy(true);
    setApplyError(null);
    setApplySuccess(false);
    try {
      const res = await fetch('/api/admin/server/apply-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configSet, mapWorkshopId: resolvedMapId, override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'server_occupied' && !override) {
          setPending({ kind: 'apply', message: body.error });
          return;
        }
        setApplyError(body.error ?? 'Could not apply config');
        return;
      }
      setPending(null);
      setApplySuccess(true);
      await refreshStatus();
    } finally {
      setApplyBusy(false);
    }
  };

  const confirmPending = () => {
    if (!pending) return;
    const kind = pending.kind;
    setPending(null);
    if (kind === 'start') startServer(true);
    else if (kind === 'stop') stopServer(true);
    else applyConfig(true);
  };

  const teardown = async () => {
    if (!active) return;
    setTeardownBusy(true);
    setTeardownError(null);
    try {
      const res = await fetch(`/api/matches/${active.matchId}/server/teardown`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setTeardownError(body.error ?? 'Could not stop the server');
        return;
      }
      router.refresh();
      await refreshStatus();
    } finally {
      setTeardownBusy(false);
    }
  };

  const server = status?.server ?? null;
  const configured = status?.configured ?? true;
  // Prefer status.active (fresher — refetched on load/poll/action) once we have it at all; only fall
  // back to the server-rendered initial prop before the first client fetch resolves.
  const active = status ? status.active : initialActive;
  const canStart = configured && server && !server.on && !server.booting;
  const canStop = configured && server && (server.on || server.booting);
  const casualUse = configured && server && !active && (server.players_online ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Match occupancy */}
      <div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-2">Match occupancy</div>
        {!active ? (
          <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-6 font-mono text-[13px] text-[var(--color-text-secondary)]">
            Shared server is <span className="text-[var(--color-accent-green-fg)]">idle</span> — no match is holding it.
          </div>
        ) : (
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
                  {active.serverStartedAt && <span>since {fmtUtcShort(active.serverStartedAt)}</span>}
                </div>
              </div>
              <button
                onClick={teardown}
                disabled={teardownBusy}
                className="shrink-0 font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] disabled:opacity-50"
              >
                {teardownBusy ? 'Stopping…' : 'Tear down'}
              </button>
            </div>
            {teardownError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-2">{teardownError}</div>}
          </div>
        )}
      </div>

      {/* Server state + apply config */}
      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
        {pending && (
          <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] rounded px-3 py-2 mb-3">
            <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mb-2">{pending.message}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPending(null)}
                className="font-mono text-[11px] px-3 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                Cancel
              </button>
              <button
                onClick={confirmPending}
                className="font-mono text-[11px] px-3 py-1 rounded border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] hover:bg-[var(--color-accent-amber-bg)]"
              >
                Override anyway
              </button>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-2">
              <StatePill configured={configured} server={server} />
              DatHost server
            </div>
            {server && (
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex flex-col gap-y-1">
                {status?.connect && (
                  <span className="inline-flex items-center gap-1.5">
                    connect {status.connect}
                    <CopyConnectButton connect={status.connect} />
                  </span>
                )}
                {server.cs2_settings?.game_mode != null && <span>mode {String(server.cs2_settings.game_mode)}</span>}
                {server.players_online != null && (
                  <span className={casualUse ? 'text-[var(--color-accent-amber-fg)]' : undefined}>
                    {server.players_online} player(s) online
                    {casualUse && ' — no active DGLS match (manual/casual use?)'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 flex gap-2">
            {canStart && (
              <button
                onClick={() => startServer()}
                disabled={startStopBusy}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-bg)] disabled:opacity-50"
              >
                {startStopBusy ? '…' : 'Start'}
              </button>
            )}
            {canStop && (
              <button
                onClick={() => stopServer()}
                disabled={startStopBusy}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] disabled:opacity-50"
              >
                {startStopBusy ? '…' : 'Stop'}
              </button>
            )}
          </div>
        </div>
        {(statusError || startStopError || status?.error) && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mb-3">
            {statusError ?? startStopError ?? status?.error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <select
            value={configSet}
            onChange={(e) => setConfigSet(e.target.value)}
            className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
          >
            {configSets.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={mapChoice}
            onChange={(e) => setMapChoice(e.target.value)}
            className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
          >
            <option value="">Select a map…</option>
            {maps.map((m) => (
              <option key={m.workshopId} value={m.workshopId}>
                {toSentenceCase(m.name)}
              </option>
            ))}
            <option value={CUSTOM_MAP_CHOICE}>Custom workshop ID…</option>
          </select>
          {mapChoice === CUSTOM_MAP_CHOICE && (
            <>
              <input
                value={customMapId}
                onChange={(e) => setCustomMapId(e.target.value)}
                placeholder="Steam workshop ID or URL"
                className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
              />
              {customMapInvalid && (
                <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">
                  Enter a valid Steam workshop ID or URL.
                </div>
              )}
            </>
          )}
          <button
            onClick={() => applyConfig()}
            disabled={!configSet || !resolvedMapId || applyBusy}
            className="self-start font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
          >
            {applyBusy ? 'Applying…' : 'Apply config'}
          </button>
          {applyError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{applyError}</div>}
          {applySuccess && !applyError && (
            <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Applied.</div>
          )}
        </div>
      </div>

      {/* Disk cleanup (#132) */}
      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-2">
          Disk cleanup <span className="text-[var(--color-text-secondary)]">— stale per-match MatchZy artifacts</span>
        </div>
        {!cleanup ? (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)] flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={
                  cleanup.enabled === false ? 'text-[var(--color-accent-amber-fg)]' : 'text-[var(--color-accent-green-fg)]'
                }
              >
                {cleanup.enabled === null ? 'unknown' : cleanup.enabled ? 'scheduled' : 'paused'}
              </span>
              <span>last run: {lastRunSummary(cleanup.lastRun)}</span>
              {cleanup.lastRun && (
                <a
                  href={cleanup.lastRun.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent-blue-fg)] hover:underline"
                >
                  view run
                </a>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={toggleCleanupEnabled}
                disabled={cleanupToggleBusy || cleanup.enabled === null}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
              >
                {cleanupToggleBusy ? '…' : cleanup.enabled ? 'Pause schedule' : 'Resume schedule'}
              </button>
              <button
                onClick={runCleanupNow}
                disabled={cleanupRunBusy}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
              >
                {cleanupRunBusy ? 'Triggering…' : 'Run now'}
              </button>
            </div>
            {cleanupRunMessage && (
              <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">{cleanupRunMessage}</div>
            )}

            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">Run every</span>
              <input
                type="number"
                min={1}
                value={intervalInput}
                onChange={(e) => {
                  setIntervalInput(e.target.value);
                  setIntervalSaved(false);
                }}
                className="w-16 font-mono text-[12px] px-2 py-1 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
              />
              <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">day(s)</span>
              <button
                onClick={saveInterval}
                disabled={intervalBusy || !intervalInput || Number(intervalInput) === cleanup.intervalDays}
                className="font-mono text-[11px] px-3 py-1 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
              >
                {intervalBusy ? 'Saving…' : 'Save'}
              </button>
              {intervalSaved && <span className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Saved.</span>}
            </div>
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              The underlying job still checks daily — this only controls how often it actually deletes anything.
            </div>

            {cleanupError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{cleanupError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
