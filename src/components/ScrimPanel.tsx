'use client';

// Public scrim panel — any signed-in player can pick a config set + map and start the shared DatHost
// server for a casual, free-form game, outside the DGLS match model (no roster/veto/stats). This
// "publicizes" the slice of the admin server console (`ServerConsolePanel`) that matters for a scrim:
// raw server state via the shared `ServerConnectionDetails`/`ConnectedRoster` (`ServerStatusBits.tsx`)
// and `LaunchOptionsPicker`, start/stop/apply. The connected roster (`ScrimStatus.connectedPlayers`)
// is a real name list, not just DatHost's bare `players_online` count, derived from the console log
// (`getConnectedPlayers`, `server-players.ts`). A league match holding the server is shown read-only
// with no controls; starting is refused outright (no override) if the server is occupied, a scrim is
// already running, or a nearby league match hasn't been scored yet — see `/api/scrim/start`. "Play out
// all rounds" toggles `matchzy_playout_enabled_default`; "Friendly" toggles `FRIENDLY_CVARS` (no
// auto-kick, drop-knife pickup, no forced spectator camera, shoot dropped grenades) — both for the
// session only, on top of whichever config set is picked. Apply config set
// (`/api/scrim/apply-config`) pushes the picked set without starting — same no-override occupancy
// refusal as Start, no admin gate either, since it never does more than a scrim start already could.
// Stop is only shown to whoever started the scrim (or an admin) — `status.canStop`.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ServerSpinner } from '@/components/ServerSpinner';
import { StatePill, ServerConnectionDetails, ConnectedRoster } from '@/components/ServerStatusBits';
import { CUSTOM_MAP_CHOICE } from '@/components/MapPicker';
import { LaunchOptionsPicker } from '@/components/LaunchOptionsPicker';
import { workshopIdFromUrl } from '@/lib/replay/radar';
import { isServerLive } from '@/lib/util';
import type { ConfigSetOption } from '@/lib/dathost-config';
import type { WorkshopMapOption } from '@/lib/queries';
import { useScrimStatus } from '@/components/ScrimStatusContext';

const ACTION_CAP_MS = 90_000;

export function ScrimPanel({ configSets, maps }: { configSets: ConfigSetOption[]; maps: WorkshopMapOption[] }) {
  const { status, error: statusError, refresh: refreshStatus, requestFastPoll } = useScrimStatus();

  const [configSet, setConfigSet] = useState(configSets[0]?.key ?? '');
  const [mapChoice, setMapChoice] = useState('');
  const [customMapId, setCustomMapId] = useState('');
  const [playout, setPlayout] = useState(false);
  const [friendly, setFriendly] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  useEffect(() => {
    requestFastPoll(true);
    return () => requestFastPoll(false);
  }, [requestFastPoll]);

  const resolvedMapId = mapChoice === CUSTOM_MAP_CHOICE ? workshopIdFromUrl(customMapId.trim()) : mapChoice || null;
  const customMapInvalid = mapChoice === CUSTOM_MAP_CHOICE && customMapId.trim() !== '' && !resolvedMapId;

  const startScrim = async () => {
    if (!configSet || !resolvedMapId) return;
    setStarting(true);
    setStartError(null);
    const startedAt = Date.now();
    try {
      const res = await fetch('/api/scrim/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configSet, mapWorkshopId: resolvedMapId, playout, friendly }),
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

  const applyConfig = async () => {
    if (!configSet || !resolvedMapId) return;
    setApplyBusy(true);
    setApplyError(null);
    setApplySuccess(false);
    try {
      const res = await fetch('/api/scrim/apply-config', {
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
    } finally {
      setApplyBusy(false);
    }
  };

  const stopScrim = async () => {
    setStopping(true);
    setStopError(null);
    try {
      const res = await fetch('/api/scrim/stop', { method: 'POST' });
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

  const serverOn = isServerLive(server);

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
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <ServerConnectionDetails
                  connect={status.connect}
                  serverOn={serverOn}
                  startedByName={!status.canStop ? status.startedByName : null}
                />
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
            ) : serverOn && status.canStop ? (
              <button
                onClick={stopScrim}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)]"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>

        {(statusError || startError || stopError || applyError || status.error) && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mb-3">
            {statusError ?? startError ?? stopError ?? applyError ?? status.error}
          </div>
        )}

        {!serverOn && !starting && (
          <div className="flex flex-col gap-2">
            <LaunchOptionsPicker
              configSets={configSets}
              configSet={configSet}
              onConfigSetChange={setConfigSet}
              maps={maps}
              mapChoice={mapChoice}
              onMapChoiceChange={setMapChoice}
              customMapId={customMapId}
              onCustomMapIdChange={setCustomMapId}
              customMapInvalid={customMapInvalid}
              playout={playout}
              onPlayoutChange={setPlayout}
              friendly={friendly}
              onFriendlyChange={setFriendly}
              disabled={!!blockingMatch}
            />
            <div className="flex gap-2">
              <button
                onClick={startScrim}
                disabled={!configSet || !resolvedMapId || !!blockingMatch}
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-bg)] disabled:opacity-50"
              >
                Start scrim
              </button>
              <button
                onClick={applyConfig}
                disabled={!configSet || !resolvedMapId || !!blockingMatch || applyBusy}
                title="Reassert this config set on the server without starting it"
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
              >
                {applyBusy ? 'Applying…' : 'Apply config set'}
              </button>
            </div>
            {applySuccess && !applyError && (
              <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Applied.</div>
            )}
          </div>
        )}

        {/* Connected roster — shared with the admin console (`ConnectedRoster`), kept in the same box
            as the state pill/controls above instead of a separate, unstyled section. */}
        {serverOn && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border-tertiary)]">
            <ConnectedRoster connectedPlayers={connectedPlayers} />
          </div>
        )}
      </div>
    </div>
  );
}
