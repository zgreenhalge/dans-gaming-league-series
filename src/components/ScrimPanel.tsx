'use client';

// Public scrim panel — any signed-in player can pick a map and start the shared DatHost server for a
// casual, free-form game, outside the DGLS match model (no roster/veto/stats). This "publicizes" the
// slice of the admin server console (`ServerConsolePanel`) that matters for a scrim: raw server
// state, a map picker, start/stop — plus the currently-connected roster (`ScrimStatus.connectedPlayers`,
// derived from the console log, since `players_online` alone is a bare count). A league match holding
// the server is shown read-only with no controls; starting is refused outright (no override) if the
// server is occupied or a nearby league match hasn't been scored yet — see `/api/scrims/start`.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ServerSpinner } from '@/components/ServerSpinner';
import { StatePill, CopyConnectButton } from '@/components/ServerStatusBits';
import { toSentenceCase } from '@/lib/maps';
import { workshopIdFromUrl } from '@/lib/replay/radar';
import type { WorkshopMapOption } from '@/lib/queries';
import type { ScrimStatus } from '@/app/api/scrims/status/route';

const CUSTOM_MAP_CHOICE = '__custom__';
const ACTION_CAP_MS = 90_000;

export function ScrimPanel({ maps }: { maps: WorkshopMapOption[] }) {
  const [status, setStatus] = useState<ScrimStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [mapChoice, setMapChoice] = useState('');
  const [customMapId, setCustomMapId] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/scrims/status');
      if (!res.ok) {
        setStatusError('Could not load server status');
        return;
      }
      setStatus((await res.json()) as ScrimStatus);
      setStatusError(null);
    } catch {
      setStatusError('Could not load server status');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await refreshStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const interval = setInterval(refreshStatus, 3_000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const resolvedMapId = mapChoice === CUSTOM_MAP_CHOICE ? workshopIdFromUrl(customMapId.trim()) : mapChoice || null;
  const customMapInvalid = mapChoice === CUSTOM_MAP_CHOICE && customMapId.trim() !== '' && !resolvedMapId;

  const startScrim = async () => {
    if (!resolvedMapId) return;
    setStarting(true);
    setStartError(null);
    const startedAt = Date.now();
    try {
      const res = await fetch('/api/scrims/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapWorkshopId: resolvedMapId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStartError(body.error ?? 'Could not start the server');
        return;
      }
      // Poll status until the server reports ready (or give up after the cap) so the spinner tracks
      // the real boot, same pattern as the admin console's start button.
      while (Date.now() - startedAt < ACTION_CAP_MS) {
        await new Promise((r) => setTimeout(r, 2_000));
        await refreshStatus();
      }
    } finally {
      setStarting(false);
      await refreshStatus();
    }
  };

  const stopScrim = async () => {
    setStopping(true);
    setStopError(null);
    try {
      const res = await fetch('/api/scrims/stop', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStopError(body.error ?? 'Could not stop the server');
        return;
      }
      await refreshStatus();
    } finally {
      setStopping(false);
    }
  };

  if (!status) {
    return <div className="font-mono text-[13px] text-[var(--color-text-secondary)]">Loading…</div>;
  }

  if (!status.configured) {
    return (
      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-6 font-mono text-[13px] text-[var(--color-text-secondary)]">
        Hosting isn&apos;t configured for this environment.
      </div>
    );
  }

  const { server, active, connectedPlayers, blockingMatch } = status;

  // A real DGLS match holds the server — read-only, no scrim controls.
  if (active) {
    return (
      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-1">
          League match in progress — <span className="text-[var(--color-accent-amber-fg)]">{active.serverState}</span>
        </div>
        <Link href={`/matches/${active.matchId}`} className="font-display text-[16px] font-semibold hover:underline">
          {active.label}
        </Link>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2">
          The shared server is reserved for this match — try again once it wraps up.
        </div>
      </div>
    );
  }

  const serverOn = !!server?.on && !server.booting;

  return (
    <div className="flex flex-col gap-4">
      {blockingMatch && (
        <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] rounded px-3 py-2 font-mono text-[11px] text-[var(--color-accent-amber-fg)]">
          {blockingMatch.label} is scheduled too close to now and hasn&apos;t been scored yet — the server is reserved for it.
        </div>
      )}

      <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-2">
              <StatePill configured={status.configured} server={server} />
              Scrim server
            </div>
            {server && (
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex flex-col gap-y-1">
                {status.connect && (
                  <span className="inline-flex items-center gap-1.5">
                    connect {status.connect}
                    <CopyConnectButton connect={status.connect} />
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="shrink-0">
            {starting ? (
              <div className="w-40">
                <ServerSpinner label="Starting server…" />
              </div>
            ) : stopping ? (
              <div className="w-40">
                <ServerSpinner label="Stopping server…" tone="stop" />
              </div>
            ) : serverOn ? (
              <button
                onClick={stopScrim}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)]"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>

        {(statusError || startError || stopError || status.error) && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mb-3">
            {statusError ?? startError ?? stopError ?? status.error}
          </div>
        )}

        {!serverOn && !starting && (
          <div className="flex flex-col gap-2">
            <select
              value={mapChoice}
              onChange={(e) => setMapChoice(e.target.value)}
              disabled={!!blockingMatch}
              className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] disabled:opacity-50"
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
              onClick={startScrim}
              disabled={!resolvedMapId || !!blockingMatch}
              className="self-start font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-bg)] disabled:opacity-50"
            >
              Start scrim
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-2">
          Connected {connectedPlayers.length > 0 && `(${connectedPlayers.length})`}
        </div>
        {!serverOn ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)]">Server is off.</div>
        ) : connectedPlayers.length === 0 ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)]">No one connected yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {connectedPlayers.map((p, i) => (
              <li key={`${p.steamId ?? 'pending'}-${i}`} className="font-mono text-[13px] text-[var(--color-text-primary)]">
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
