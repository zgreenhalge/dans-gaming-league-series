'use client';

// Admin server console (#134/#135, admin console b — now server-centric). Two sections: raw DatHost
// server state + start/stop + apply-a-config-set (map picker + config-set dropdown, settings only —
// doesn't start the server) combined in one panel, and match occupancy (who holds it right now +
// Teardown, for the autostop-failed safety valve). The per-match MatchServerPanel still handles
// per-match provisioning on the match page; this is the global operator view.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Check } from 'lucide-react';
import { getBrowserClient } from '@/lib/supabase-browser';
import { fmtUtcShort } from '@/lib/util';
import { toSentenceCase } from '@/lib/maps';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';
import type { ConfigSetOption } from '@/lib/dathost';
import type { WorkshopMapOption } from '@/lib/queries';
import type { AdminServerStatus } from '@/app/api/admin/server/status/route';

const CUSTOM_MAP_CHOICE = '__custom__';

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

export function ServerConsolePanel({
  active,
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

  // Keep the console live — any match-row change (provision/teardown/reconcile) re-renders the
  // occupancy section and re-reads raw server status (start/stop/config changes made elsewhere).
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

  const startServer = async () => {
    setStartStopBusy(true);
    setStartStopError(null);
    try {
      const res = await fetch('/api/admin/server/start', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStartStopError(body.error ?? 'Could not start the server');
        return;
      }
      await refreshStatus();
    } finally {
      setStartStopBusy(false);
    }
  };

  const stopServer = async () => {
    setStartStopBusy(true);
    setStartStopError(null);
    try {
      const res = await fetch('/api/admin/server/stop', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStartStopError(body.error ?? 'Could not stop the server');
        return;
      }
      await refreshStatus();
    } finally {
      setStartStopBusy(false);
    }
  };

  const resolvedMapId = mapChoice === CUSTOM_MAP_CHOICE ? customMapId.trim() : mapChoice;

  const applyConfig = async () => {
    if (!configSet || !resolvedMapId) return;
    setApplyBusy(true);
    setApplyError(null);
    setApplySuccess(false);
    try {
      const res = await fetch('/api/admin/server/apply-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configSet, mapWorkshopId: resolvedMapId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setApplyError(body.error ?? 'Could not apply config');
        return;
      }
      setApplySuccess(true);
      await refreshStatus();
    } finally {
      setApplyBusy(false);
    }
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
  const canStart = configured && server && !server.on && !server.booting;
  const canStop = configured && server && (server.on || server.booting);

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
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-2">
              <StatePill configured={configured} server={server} />
              DatHost server
            </div>
            {server && (
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex flex-col gap-y-1">
                {(server.custom_domain ?? server.raw_ip) && server.ports?.game && (
                  <span className="inline-flex items-center gap-1.5">
                    connect {server.custom_domain ?? server.raw_ip}:{server.ports.game}
                    <CopyConnectButton connect={`${server.custom_domain ?? server.raw_ip}:${server.ports.game}`} />
                  </span>
                )}
                {server.cs2_settings?.game_mode != null && <span>mode {String(server.cs2_settings.game_mode)}</span>}
                {server.players_online != null && <span>{server.players_online} player(s) online</span>}
              </div>
            )}
          </div>
          <div className="shrink-0 flex gap-2">
            {canStart && (
              <button
                onClick={startServer}
                disabled={startStopBusy}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-bg)] disabled:opacity-50"
              >
                {startStopBusy ? '…' : 'Start'}
              </button>
            )}
            {canStop && (
              <button
                onClick={stopServer}
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
            className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-transparent"
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
            className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-transparent"
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
            <input
              value={customMapId}
              onChange={(e) => setCustomMapId(e.target.value)}
              placeholder="Steam workshop ID"
              className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-transparent"
            />
          )}
          <button
            onClick={applyConfig}
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
    </div>
  );
}
