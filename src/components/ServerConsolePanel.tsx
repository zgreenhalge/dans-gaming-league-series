'use client';

// Admin server console (#134/#135, admin console b — now server-centric). One panel: occupancy/raw
// DatHost state at top (Stop, plus, on an occupying match, "Apply match settings" — re-push the
// match's loadmatch config to restore forced map_sides + demo-upload cvars — and Teardown, the
// autostop-failed safety valve); below it, in the same box, the shared `LaunchOptionsPicker`
// (config-set + map + playout/friendly toggles) with Start and Apply config set side by side — Start
// boots with them, Apply config set pushes them without starting (settings-only, doesn't load a match
// config) — and "Compare to live config" (read-only drift check against the selected config set).
// Below that, disk cleanup (issue #132) — enable/disable + interval + a manual "run now" for the
// dathost-cleanup GitHub Action. The per-match MatchServerPanel still handles per-match provisioning
// on the match page; this is the global operator view.
//
// Start/Stop/Apply are occupancy-checked server-side (getServerOccupancy) — a DGLS match holding the
// server, or live players on it with no DGLS match at all (casual/manual use), both refuse the action
// with a 409 unless `override: true`. On that refusal this component shows an inline confirm-or-cancel
// prompt rather than silently blocking or silently proceeding.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase-browser';
import { ServerSpinner } from '@/components/ServerSpinner';
import { StatePill, ServerConnectionDetails, ConnectedRoster } from '@/components/ServerStatusBits';
import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { CUSTOM_MAP_CHOICE } from '@/components/MapPicker';
import { LaunchOptionsPicker } from '@/components/LaunchOptionsPicker';
import { fmtUtcShort, isServerLive, isServerOff } from '@/lib/util';
import { workshopIdFromUrl } from '@/lib/replay/radar';
import type { ActiveServerMatch } from '@/lib/dathost-lifecycle';
import type { ConfigSetOption, ConfigSetDiff, DiffRow, CfgFileDiff } from '@/lib/dathost-config';
import type { WorkshopMapOption } from '@/lib/queries';
import type { AdminServerStatus } from '@/app/api/admin/server/status/route';
import type { DathostCleanupStatus } from '@/app/api/admin/dathost-cleanup/status/route';

// Safety cap for the start/stop spinner — matches DatHost's own ready timeout (waitUntilReady). If an
// action hasn't visibly settled by now, drop the spinner and show whatever raw state we have.
const ACTION_CAP_MS = 90_000;

// A start command's acknowledgment can briefly report `on: true` before the box has actually begun
// booting — floor how long a start must have been running before `on && !booting` is trusted as ready,
// so that flicker can't read as an instant "done." A fixed floor (rather than requiring the poll to
// have caught an intermediate `booting: true` tick) can't be raced by a boot that completes faster
// than the 2s poll interval.
const MIN_BOOT_MS = 5_000;

type PendingAction = { kind: 'start' | 'stop' | 'apply'; message: string };

// Read-only render of the golden-config diff — only rows that differ (drift/missing), so a clean
// server shows nothing but the "matches golden" line. `drift` (a real value mismatch) is red;
// `missing` (present one side only) is amber.
function DriftRows({ rows }: { rows: DiffRow[] }) {
  const changed = rows.filter((r) => r.status === 'drift' || r.status === 'missing');
  if (changed.length === 0) return null;
  return (
    <div className="font-mono text-[11px] flex flex-col gap-1 mt-1">
      {changed.map((r) => (
        <div key={r.key} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[var(--color-text-primary)]">{r.key}</span>
          <span className="text-[var(--color-text-secondary)]">set {r.local}</span>
          <span className="text-[var(--color-text-secondary)]">→</span>
          <span className={r.status === 'drift' ? 'text-[var(--color-accent-red-fg)]' : 'text-[var(--color-accent-amber-fg)]'}>
            live {r.live}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConfigDiffView({ diff }: { diff: ConfigSetDiff }) {
  const settingsDrift = diff.settings.filter((r) => r.status === 'drift' || r.status === 'missing');
  const cfgWithDrift = diff.cfgFiles.filter(
    (f: CfgFileDiff) => f.error || f.rows.some((r) => r.status === 'drift' || r.status === 'missing'),
  );
  return (
    <div className="flex flex-col gap-3 mt-2">
      <div
        className={`font-mono text-[11px] ${
          diff.clean ? 'text-[var(--color-accent-green-fg)]' : 'text-[var(--color-accent-red-fg)]'
        }`}
      >
        {diff.clean ? '✓ live server matches the config set.' : '✗ drift found — nothing was changed.'}
      </div>

      {settingsDrift.length > 0 && (
        <div>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">Settings (cs2_settings)</div>
          <DriftRows rows={diff.settings} />
        </div>
      )}

      {cfgWithDrift.map((f: CfgFileDiff) => (
        <div key={f.remote}>
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">{f.remote}</div>
          {f.error ? (
            <div className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1">{f.error}</div>
          ) : (
            <DriftRows rows={f.rows} />
          )}
        </div>
      ))}
    </div>
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
  // In-flight action flags: set the moment Start/Stop is clicked, cleared by the status poll once the
  // action has truly landed. They swap the button for a spinner so the pill + details stay visible.
  // Refs mirror them so the []-dep refreshStatus reads the live value without a stale closure.
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  // `actionAt` caps the wait so a start/stop that never settles can't strand the spinner forever.
  const actionAtRef = useRef(0);

  const beginAction = (kind: 'start' | 'stop') => {
    actionAtRef.current = Date.now();
    startingRef.current = kind === 'start';
    stoppingRef.current = kind === 'stop';
    setStarting(kind === 'start');
    setStopping(kind === 'stop');
  };
  const endAction = () => {
    startingRef.current = false;
    stoppingRef.current = false;
    setStarting(false);
    setStopping(false);
  };

  const [configSet, setConfigSet] = useState(configSets[0]?.key ?? '');
  const [mapChoice, setMapChoice] = useState('');
  const [customMapId, setCustomMapId] = useState('');
  const [playout, setPlayout] = useState(false);
  const [friendly, setFriendly] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const [teardownBusy, setTeardownBusy] = useState(false);
  const [teardownError, setTeardownError] = useState<string | null>(null);

  const [matchCfgBusy, setMatchCfgBusy] = useState(false);
  const [matchCfgError, setMatchCfgError] = useState<string | null>(null);
  const [matchCfgSuccess, setMatchCfgSuccess] = useState(false);

  const [diff, setDiff] = useState<ConfigSetDiff | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/server/status');
      if (!res.ok) {
        setStatusError('Could not load server status');
        return;
      }
      const data = (await res.json()) as AdminServerStatus;
      setStatus(data);
      // Clear the in-flight spinner once the action has truly landed, using the exact same
      // `isServerLive`/`isServerOff` calls every other consumer here (canStart/canStop, the
      // connection-details block, the roster) treats as ready/off — a hand-rolled `on`/`booting`
      // check here that drifts from those is exactly how this got stuck before: gating on `connect`
      // too (DNS/ports DatHost can assign a beat after `on`/`booting` settle) stranded the spinner,
      // and hid Stop, for a gap where the server was already live by every other measure. `MIN_BOOT_MS`
      // is what rules out the pre-boot `on` flicker instead. Either way, give up after ACTION_CAP_MS.
      const s = data.server;
      if (s) {
        const capped = Date.now() - actionAtRef.current > ACTION_CAP_MS;
        const done = (timedOut: boolean, verb: string) => {
          startingRef.current = false;
          stoppingRef.current = false;
          setStarting(false);
          setStopping(false);
          if (timedOut) setStartStopError(`Server never reported '${verb}' success`);
        };
        if (startingRef.current) {
          const ready = isServerLive(s) && Date.now() - actionAtRef.current > MIN_BOOT_MS;
          if (ready) done(false, 'start');
          else if (capped) done(true, 'start');
        } else if (stoppingRef.current) {
          if (isServerOff(s)) done(false, 'stop');
          else if (capped) done(true, 'stop');
        }
      }
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

  // Raw DatHost state can change with no `match_server_state` row write at all (autostop after idle,
  // a start/stop from the DatHost panel directly, boot completing) — poll every 2s so the Start/Stop
  // button and boot spinner stay in sync with the real server state.
  useEffect(() => {
    const interval = setInterval(refreshStatus, 2_000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Keep the console live — any match_server_state change (provision/teardown/reconcile) re-reads raw
  // server status; router.refresh() re-fetches this component's `active` prop for consistency, but the
  // occupancy section below prefers status.active (fresher, from the same fetch) once it's loaded.
  useEffect(() => {
    const channel = getBrowserClient()
      .channel('admin-servers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_server_state' }, () => {
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
  const [intervalError, setIntervalError] = useState<string | null>(null);

  const [registerCommandsBusy, setRegisterCommandsBusy] = useState(false);
  const [registerCommandsError, setRegisterCommandsError] = useState<string | null>(null);
  const [registerCommandsMessage, setRegisterCommandsMessage] = useState<string | null>(null);

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
      setIntervalError(data.intervalError);
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
    setIntervalError(null);
    try {
      const res = await fetch('/api/admin/dathost-cleanup/interval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setIntervalError(body.error ?? 'Could not save interval');
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
      setCleanupRunMessage('Triggered — status below will update automatically.');
      // The new run won't show up in the status endpoint for a few seconds; one delayed refresh
      // is enough for an admin glancing back at this panel, no need to poll tightly for it.
      setTimeout(refreshCleanup, 5000);
    } finally {
      setCleanupRunBusy(false);
    }
  };

  const registerDiscordCommands = async () => {
    setRegisterCommandsBusy(true);
    setRegisterCommandsError(null);
    setRegisterCommandsMessage(null);
    try {
      const res = await fetch('/api/admin/discord/register-commands', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegisterCommandsError(body.error ?? 'Could not register commands');
        return;
      }
      setRegisterCommandsMessage(`Registered: ${(body.names as string[]).join(', ')}. Can take up to an hour to show up in Discord.`);
    } finally {
      setRegisterCommandsBusy(false);
    }
  };

  const startServer = async (override = false) => {
    if (!configSet || !resolvedMapId) return;
    setStartStopBusy(true);
    setStartStopError(null);
    // Optimistic: show the spinner immediately. The 2s status poll clears it once boot has settled —
    // don't refreshStatus() here, or the flag could clear mid-flight and briefly flash the button.
    beginAction('start');
    try {
      const res = await fetch('/api/admin/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configSet, mapWorkshopId: resolvedMapId, playout, friendly, override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        endAction();
        if (body.code === 'server_occupied' && !override) {
          setPending({ kind: 'start', message: body.error });
          return;
        }
        setStartStopError(body.error ?? 'Could not start the server');
        return;
      }
      setPending(null);
    } finally {
      setStartStopBusy(false);
    }
  };

  const stopServer = async (override = false) => {
    setStartStopBusy(true);
    setStartStopError(null);
    // Optimistic: show the stopping spinner immediately; the poll clears it once the box is fully off.
    beginAction('stop');
    try {
      const res = await fetch('/api/admin/server/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        endAction();
        if (body.code === 'server_occupied' && !override) {
          setPending({ kind: 'stop', message: body.error });
          return;
        }
        setStartStopError(body.error ?? 'Could not stop the server');
        return;
      }
      setPending(null);
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

  // Re-push the occupying match's MatchZy config (RCON loadmatch) — restores forced `map_sides` and
  // the demo-upload cvars after an "Apply config set" (or panel edit) clobbered them. Distinct from
  // "Apply config set" above, which pushes the server-level baseline and *wipes* the match config.
  const applyMatchConfig = async () => {
    if (!active) return;
    setMatchCfgBusy(true);
    setMatchCfgError(null);
    setMatchCfgSuccess(false);
    try {
      const res = await fetch(`/api/matches/${active.matchId}/server/apply-match-config`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMatchCfgError(body.error ?? 'Could not apply match settings');
        return;
      }
      setMatchCfgSuccess(true);
    } finally {
      setMatchCfgBusy(false);
    }
  };

  const runDiff = async () => {
    setDiffBusy(true);
    setDiffError(null);
    try {
      const res = await fetch(`/api/admin/server/config-diff?configSet=${encodeURIComponent(configSet || 'golden')}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDiffError(body.error ?? 'Could not compare config');
        return;
      }
      setDiff((await res.json()) as ConfigSetDiff);
    } catch {
      setDiffError('Could not compare config');
    } finally {
      setDiffBusy(false);
    }
  };

  const server = status?.server ?? null;
  const configured = status?.configured ?? true;
  // Prefer status.active (fresher — refetched on load/poll/action) once we have it at all; only fall
  // back to the server-rendered initial prop before the first client fetch resolves.
  const active = status ? status.active : initialActive;
  const canStart = configured && !!server && isServerOff(server);
  const canStop = configured && !!server && !isServerOff(server);
  const casualUse = !!(configured && server && !active && (server.players_online ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Status & direct controls — occupancy, raw DatHost state, and every action that responds to
          either. One group: "what's happening right now, and what can I do about it." */}
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

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-1 flex items-center gap-2">
              <StatePill configured={configured} server={server} />
              DatHost server
            </div>

            {active && (
              <>
                <Link href={`/matches/${active.matchId}`} className="font-display text-[16px] font-semibold hover:underline">
                  {active.label}
                </Link>
                <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1 flex flex-wrap gap-x-3">
                  <span className="text-[var(--color-accent-amber-fg)]">{active.serverState}</span>
                  {active.connectString && <span>connect {active.connectString}</span>}
                  {active.serverStartedAt && <span>since {fmtUtcShort(active.serverStartedAt)}</span>}
                </div>
              </>
            )}

            {/* No separate "idle" line here — the state pill above already says off/booting/on, and
                who (if anyone) holds it is exactly the `active` block above. */}
            {server && (
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <ServerConnectionDetails connect={status?.connect ?? null} serverOn={isServerLive(server)} />
                {server.cs2_settings?.game_mode != null && <span>mode {String(server.cs2_settings.game_mode)}</span>}
              </div>
            )}
          </div>

          {/* Button slot: an in-flight action shows a spinner in place of the button until the
              opposite control is available, so the pill + details above stay put. Start itself lives
              below, next to the config-set/map picker its payload comes from — this slot only ever
              needs to react to it via the shared starting/stopping state. */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            {starting ? (
              <div className="w-40">
                <ServerSpinner label="Starting server…" />
              </div>
            ) : stopping ? (
              <div className="w-40">
                <ServerSpinner label="Stopping server…" tone="stop" />
              </div>
            ) : (
              canStop && (
                <button
                  onClick={() => stopServer()}
                  disabled={startStopBusy}
                  className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] disabled:opacity-50"
                >
                  {startStopBusy ? '…' : 'Stop'}
                </button>
              )
            )}
            {active && (
              <>
                <button
                  onClick={applyMatchConfig}
                  disabled={matchCfgBusy}
                  title="Re-push this match's config (forced side + demo upload) via RCON loadmatch"
                  className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
                >
                  {matchCfgBusy ? 'Applying…' : 'Apply match settings'}
                </button>
                <button
                  onClick={teardown}
                  disabled={teardownBusy}
                  className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)] hover:bg-[var(--color-accent-red-bg)] disabled:opacity-50"
                >
                  {teardownBusy ? 'Stopping…' : 'Tear down'}
                </button>
              </>
            )}
          </div>
        </div>

        {(statusError || startStopError || status?.error) && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-3">
            {statusError ?? startStopError ?? status?.error}
          </div>
        )}
        {matchCfgError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-3">{matchCfgError}</div>}
        {matchCfgSuccess && !matchCfgError && (
          <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)] mt-3">
            Match config re-pushed — the server is in warmup / knife-select.
          </div>
        )}
        {teardownError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-3">{teardownError}</div>}

        {/* Connected roster — shared with the scrim panel (`ConnectedRoster`), amber-tinted when
            someone's on the box outside a DGLS match ("casual use") instead of a separate bare-count
            line. */}
        {server && isServerLive(server) && (
          <div className="mt-4 pt-4 border-t border-[var(--color-border-tertiary)]">
            <ConnectedRoster connectedPlayers={status?.connectedPlayers ?? []} highlight={casualUse} />
          </div>
        )}

        {/* Server config — pick a config set + map + launch-time toggles, then either Start (boot with
            them) or Apply config set (push them without starting) — the two actions that consume this
            picker's state, side by side (#315). */}
        <div className="mt-4 pt-4 border-t border-[var(--color-border-tertiary)]">
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mb-2">Server config</div>
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
            />
            <div className="flex gap-2">
              {canStart && !starting && !stopping && (
                <button
                  onClick={() => startServer()}
                  disabled={startStopBusy || !configSet || !resolvedMapId}
                  className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] hover:bg-[var(--color-accent-green-bg)] disabled:opacity-50"
                >
                  {startStopBusy ? '…' : 'Start'}
                </button>
              )}
              <button
                onClick={() => applyConfig()}
                disabled={!configSet || !resolvedMapId || applyBusy}
                title="Reassert settings on the server without starting it"
                className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
              >
                {applyBusy ? 'Applying…' : 'Apply config set'}
              </button>
            </div>
            {applyError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{applyError}</div>}
            {applySuccess && !applyError && (
              <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">Applied.</div>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-border-tertiary)]">
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={runDiff}
              disabled={diffBusy}
              className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-border-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
            >
              {diffBusy ? 'Comparing…' : 'Compare to live config'}
            </button>
          </div>
          {diffError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-2">{diffError}</div>}
          {diff && !diffError && <ConfigDiffView diff={diff} />}
        </div>
      </div>

      {/* Disk cleanup (#132) — collapsed by default; the preview still shows live schedule/last-run
          status so a paused schedule reads as amber even without expanding. */}
      <CollapsiblePanel
        title="Disk cleanup"
        preview={
          cleanup && (
            <span
              className={`font-mono text-[10px] ${
                cleanup.enabled === false ? 'text-[var(--color-accent-amber-fg)]' : 'text-[var(--color-accent-green-fg)]'
              }`}
            >
              {cleanup.enabled === null ? 'unknown' : cleanup.enabled ? 'scheduled' : 'paused'} · last run {lastRunSummary(cleanup.lastRun)}
            </span>
          )
        }
      >
        {!cleanup ? (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">Loading…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {cleanup.lastRun && (
              <div className="font-mono text-[11px]">
                <a
                  href={cleanup.lastRun.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent-blue-fg)] hover:underline"
                >
                  view last run ↗
                </a>
              </div>
            )}

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
            {intervalError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{intervalError}</div>}
            {cleanupError && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{cleanupError}</div>}
          </div>
        )}
      </CollapsiblePanel>

      {/* Discord slash-command registration (#396) — a stand-in for running
          scripts/register-discord-commands.ts locally, for pushing a command definition change to
          Discord from anywhere admin access reaches (no .env.local needed). Remove this panel and its
          route together with the script once local registration is no longer the blocker it is today. */}
      <CollapsiblePanel title="Discord commands">
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            Pushes the current command set (leaderboard/scheduled/player/name-color) to Discord. Safe
            to run repeatedly — it replaces the whole set each time.
          </div>
          <div>
            <button
              onClick={registerDiscordCommands}
              disabled={registerCommandsBusy}
              className="font-mono text-[11px] px-3 py-1.5 rounded border border-[var(--color-accent-blue-border)] text-[var(--color-accent-blue-fg)] hover:bg-[var(--color-accent-blue-bg)] disabled:opacity-50"
            >
              {registerCommandsBusy ? 'Registering…' : 'Register commands'}
            </button>
          </div>
          {registerCommandsError && (
            <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{registerCommandsError}</div>
          )}
          {registerCommandsMessage && !registerCommandsError && (
            <div className="font-mono text-[11px] text-[var(--color-accent-green-fg)]">{registerCommandsMessage}</div>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  );
}
