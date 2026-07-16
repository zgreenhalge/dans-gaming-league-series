'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Skull, Bomb, Scissors, Clock, Crosshair } from 'lucide-react';
import { tabCls } from '@/lib/util';
import { mapSlug } from '@/lib/maps';
import MapHeatmap from './MapHeatmap';
import MatchPlayerTrails from './MatchPlayerTrails';
import DevGate from './DevGate';
import { RecordingViewer, RecordingUrlForm } from './RecordingViewer';
import type { ReplayJobState, ReplayEventsView } from '@/lib/queries';
import type { ReplayEvent } from '@/lib/replay/types';
import type { Faction } from '@/lib/types';

type Side = 'CT' | 'T';

function sideClass(s: Side | null): string {
  if (s === 'CT') return 'faction-ct';
  if (s === 'T') return 'faction-t';
  return '';
}

function sideColor(s: Side | null): string | undefined {
  if (s === 'CT') return 'var(--color-ct)';
  if (s === 'T') return 'var(--color-t)';
  return undefined;
}

/** Light per-row tint + matching hover accent for the event's actor team. */
function rowTint(s: Side | null): { className: string; style?: React.CSSProperties } {
  if (!s) return { className: '' };
  return {
    className: `${sideClass(s)} faction-tint`,
    style: { ['--lift-accent' as string]: 'var(--faction)' },
  };
}

function weaponLabel(weapon: string | null): string {
  if (!weapon) return '';
  return weapon.replace(/^weapon_/, '').replace(/_/g, ' ');
}

/** Shared replay-dispatch action (Generate / Retry / Regenerate all hit the same endpoint). */
function useReplayDispatch(matchId: number) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dispatch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/replay/dispatch`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Dispatch failed (${res.status})`);
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return { dispatch, busy, error, isPending };
}

/** Status panel + Generate/Retry control, shown until a replay is ready. */
function ReplayStatusPanel({
  job,
  matchId,
  canDispatch,
}: {
  job: ReplayJobState;
  matchId: number;
  canDispatch: boolean;
}) {
  const { dispatch, busy, error, isPending } = useReplayDispatch(matchId);

  const inFlight = job.status === 'queued' || job.status === 'running';

  return (
    <div className="border border-[var(--color-border-primary)] px-5 py-6 mt-4 text-center">
      {inFlight ? (
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] space-y-2">
          <div>
            Generating replay…
            {job.stage && (
              <span className="text-[var(--color-text-primary)]"> {job.stage}</span>
            )}
          </div>
          {job.ghRunUrl && (
            <a
              href={job.ghRunUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
            >
              View logs
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            {job.status === 'failed'
              ? `Replay generation failed${job.stage ? ` at "${job.stage}"` : ''}.`
              : 'No replay has been generated for this match yet.'}
          </div>
          {job.status === 'failed' && job.errorMessage && (
            <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] max-w-md mx-auto break-words">
              {job.errorMessage}
            </div>
          )}
          {canDispatch ? (
            <button
              type="button"
              onClick={dispatch}
              disabled={busy || isPending}
              className="lift-card border border-[var(--color-border-primary)] px-4 py-2 text-[12px] font-semibold disabled:opacity-50"
            >
              {busy || isPending
                ? 'Starting…'
                : job.status === 'failed'
                  ? 'Retry'
                  : 'Generate replay'}
            </button>
          ) : (
            <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              A player in this match or an admin can generate the replay.
            </div>
          )}
          {error && (
            <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}

const ROW_BASE =
  'flex items-center gap-2 py-1.5 px-3 text-[12px] border-b border-[var(--color-border-tertiary)] last:border-b-0';

function PlayerName({ id, nameOf, sideOf }: { id: number | null; nameOf: (id: number | null) => string; sideOf: (id: number | null) => Side | null }) {
  return (
    <span className="font-semibold" style={{ color: sideColor(sideOf(id)) }}>
      {nameOf(id)}
    </span>
  );
}

/** The icon + text for one event, keyed by event type. */
function eventContent(ev: ReplayEvent, name: (id: number | null) => React.ReactNode): React.ReactNode {
  if (ev.type === 'kill') {
    return (
      <>
        <Crosshair size={13} className="text-[var(--color-text-secondary)] shrink-0" />
        {name(ev.attackerId)}
        {ev.assisterId !== null && (
          <>
            <span className="text-[var(--color-text-secondary)]">+</span>
            {name(ev.assisterId)}
          </>
        )}
        <span className="text-[var(--color-text-secondary)] font-mono text-[11px]">
          {weaponLabel(ev.weapon)}
        </span>
        {ev.headshot && <span title="Headshot" className="text-[var(--color-text-secondary)]">⊙</span>}
        {name(ev.victimId)}
      </>
    );
  }
  if (ev.type === 'plant') {
    return (
      <>
        <Bomb size={13} className="text-[var(--color-text-secondary)] shrink-0" />
        {name(ev.playerId)}
        <span className="text-[var(--color-text-secondary)]">
          planted the bomb{ev.site ? ` on ${ev.site}` : ''}
        </span>
      </>
    );
  }
  if (ev.type === 'defuse') {
    return (
      <>
        <Scissors size={13} className="text-[var(--color-text-secondary)] shrink-0" />
        {name(ev.playerId)}
        <span className="text-[var(--color-text-secondary)]">defused the bomb</span>
      </>
    );
  }
  // round_end
  const Icon =
    ev.condition === 'bomb' ? Bomb : ev.condition === 'defuse' ? Scissors : ev.condition === 'time' ? Clock : Skull;
  return (
    <>
      <Icon size={13} className="text-[var(--color-text-secondary)] shrink-0" />
      <span className="text-[var(--color-text-secondary)]">Round won by</span>
      <span className="font-semibold" style={{ color: sideColor(ev.winnerSide) }}>
        {ev.winnerFaction ?? ev.winnerSide}
      </span>
    </>
  );
}

function EventRow({
  ev,
  nameOf,
  sideOf,
  onClick,
  active,
}: {
  ev: ReplayEvent;
  nameOf: (id: number | null) => string;
  sideOf: (id: number | null) => Side | null;
  /** Seeks the synced 2D replay to this event. */
  onClick: () => void;
  /** Highlights the row as the one at the synced 2D replay's current tick. */
  active: boolean;
}) {
  const name = (id: number | null) => <PlayerName id={id} nameOf={nameOf} sideOf={sideOf} />;
  const tint = ev.type === 'round_end' ? rowTint(ev.winnerSide) : { className: '' };
  const activeCls = active ? 'bg-[var(--color-bg-tertiary)] border-l-2 border-l-[var(--color-site-accent)]' : '';

  return (
    <li className={`${tint.className} ${activeCls}`} style={tint.style}>
      <button type="button" onClick={onClick} className={`${ROW_BASE} lift-row w-full text-left`}>
        {eventContent(ev, name)}
      </button>
    </li>
  );
}

/** Identifies one event by its position within `ReplayEventsView` (round number + index in that round's list). */
type ActiveEvent = { round: number; index: number } | null;

/** The last event at or before `tick` within `round` — `null` before the round's first event fires. */
function computeActiveEvent(events: ReplayEventsView, round: number, tick: number): ActiveEvent {
  const r = events.rounds.find((rr) => rr.round === round);
  if (!r) return null;
  let index = -1;
  for (let i = 0; i < r.events.length; i++) {
    if (r.events[i].tick <= tick) index = i;
    else break;
  }
  return index >= 0 ? { round, index } : null;
}

/**
 * Events list docked beside the 2D Replay (`sub === 'replay'`): auto-scrolls to and
 * highlights the event at the player's current tick, and seeks the player on click.
 */
function SyncedEventsPanel({
  events,
  active,
  onSeek,
  height,
}: {
  events: ReplayEventsView;
  active: ActiveEvent;
  onSeek: (round: number, tick?: number) => void;
  /** Measured height (px) of the replay player it's docked beside — falls back to a fixed max-height until measured. */
  height: number | null;
}) {
  const playerById = new Map(events.players.map((p) => [p.id, p]));
  const nameOf = (id: number | null): string =>
    id === null ? 'world' : (playerById.get(id)?.name ?? `#${id}`);
  const roundRefs = useRef(new Map<number, HTMLDivElement>());
  const containerRef = useRef<HTMLDivElement>(null);
  // True while the user is mid-scroll (wheel/touch/scrollbar drag) — auto-follow backs
  // off so it doesn't fight them while they're reading back through the feed, then
  // resumes once they stop. Set by the container's own 'scroll' events, but ignored
  // for the duration of our own scrollIntoView calls (flagged via `programmatic`).
  const userScrollingRef = useRef(false);
  const programmaticRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticRef.current) return;
      userScrollingRef.current = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        userScrollingRef.current = false;
      }, 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (active === null || userScrollingRef.current) return;
    const container = containerRef.current;
    const el = roundRefs.current.get(active.round);
    if (!container || !el) return;
    programmaticRef.current = true;
    // Scroll the container itself (not `el.scrollIntoView`, which walks up and scrolls
    // every scrollable ancestor — including the page — to bring `el` into view).
    const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollBy({ top: delta, behavior: 'smooth' });
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    // Smooth scrollIntoView fires its own 'scroll' events as it animates — hold off
    // treating those as user input until it's had time to settle.
    settleTimerRef.current = setTimeout(() => {
      programmaticRef.current = false;
    }, 500);
    // Only the round changing should re-snap — moving to the next event within the
    // round already showing shouldn't re-trigger a scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.round]);

  return (
    <div
      ref={containerRef}
      className={`border border-[var(--color-border-primary)] overflow-y-auto ${height ? '' : 'max-h-64'}`}
      style={height ? { height } : undefined}
    >
      <div className="space-y-5 p-2">
        {events.rounds.map((round) => {
          const sideOf = (id: number | null): Side | null => {
            if (id === null) return null;
            const faction = playerById.get(id)?.faction;
            if (!faction) return null;
            return round.sideByFaction[faction as Faction];
          };
          return (
            <div
              key={round.round}
              ref={(el) => {
                if (el) roundRefs.current.set(round.round, el);
                else roundRefs.current.delete(round.round);
              }}
              className="border border-[var(--color-border-primary)]"
            >
              <button
                type="button"
                onClick={() => onSeek(round.round)}
                className="lift-row w-full bg-[var(--color-bg-secondary)] px-3 py-2 border-b border-[var(--color-border-primary)] flex items-center gap-3 text-left"
                title="Jump the 2D replay here"
              >
                <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">
                  {round.isKnifeRound ? 'Knife Round' : `Round ${round.round}`}
                </span>
              </button>
              <ul>
                {round.events.map((ev, i) => (
                  <EventRow
                    key={i}
                    ev={ev}
                    nameOf={nameOf}
                    sideOf={sideOf}
                    active={active?.round === round.round && active.index === i}
                    onClick={() => onSeek(round.round, ev.tick)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The player is a canvas-only client component — load it lazily and skip SSR so its
// payload fetch + RAF loop never run on the server.
const ReplayPlayer = dynamic(() => import('./ReplayPlayer'), {
  ssr: false,
  loading: () => (
    <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-text-secondary)]">
      Loading replay…
    </div>
  ),
});

type RecapSubTab = 'replay' | 'heatmap' | 'trails' | 'recording';

export default function MatchRecapTab({
  job,
  events,
  matchId,
  matchMap,
  canDispatch,
  recordingURL,
  canEditRecording,
}: {
  job: ReplayJobState;
  events: ReplayEventsView | null;
  matchId: number;
  matchMap: string | null;
  canDispatch: boolean;
  recordingURL: string | null;
  /** Whether the current viewer may set/replace the recording URL (admins + in-match players). */
  canEditRecording: boolean;
}) {
  const [sub, setSub] = useState<RecapSubTab>('replay');
  // This match's own heatmap (#128) — scoped to the single match.
  const thisMatch = useMemo(() => [matchId], [matchId]);
  const visibleMatchIds = useMemo(() => new Set([matchId]), [matchId]);
  // Clicking a round header or an event in the synced panel seeks the replay. The
  // nonce makes a repeat click on the same target re-fire the jump.
  const [jump, setJump] = useState<{ round: number; n: number; tick?: number } | null>(null);
  const seek = useCallback((round: number, tick?: number) => {
    setJump((prev) => ({ round, tick, n: (prev?.n ?? 0) + 1 }));
  }, []);

  // The synced events panel's highlighted row — tracked via ReplayPlayer's onPosition,
  // which fires every drawn frame, so this only calls setState when the active event
  // actually changes (not per-frame) to avoid re-rendering the panel at playback rate.
  const [activeEvent, setActiveEvent] = useState<ActiveEvent>(null);
  const activeEventRef = useRef<ActiveEvent>(null);

  // Measures the replay player's actual rendered height (canvas + controls) so the
  // synced events panel beside it can match it exactly and scroll its own overflow,
  // rather than the page growing past the fold to show every round. A callback ref
  // (re)creates the observer whenever the wrapper node itself changes — including
  // when switching away from and back to the 2D Replay sub-tab remounts it — rather
  // than attaching once at `MatchRecapTab`'s own mount, which would leave the
  // observer watching a stale, detached node after the first tab switch.
  const playerHeightObserverRef = useRef<ResizeObserver | null>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  const playerWrapRef = useCallback((el: HTMLDivElement | null) => {
    playerHeightObserverRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setPlayerHeight(h);
    });
    ro.observe(el);
    playerHeightObserverRef.current = ro;
  }, []);
  const handlePosition = useCallback(
    (round: number, tick: number) => {
      if (!events) return;
      const next = computeActiveEvent(events, round, tick);
      const prev = activeEventRef.current;
      if (prev?.round !== next?.round || prev?.index !== next?.index) {
        activeEventRef.current = next;
        setActiveEvent(next);
      }
    },
    [events],
  );

  // The Recording sub-tab needs neither a demo nor a generated replay — it's shown
  // whenever there's already a recording to watch, or the viewer could add one.
  const showRecording = !!recordingURL || canEditRecording;
  // Heatmap and Pathing are both built from the same replay-extract artifacts as the
  // 2D Replay (`heatmap.json` alongside `replay.json`, or the payload's own `frames`),
  // so neither is ready before `events` is — one shared gate for both.
  const showReplayDerived = !!matchMap && !!events;
  const showHeatmap = showReplayDerived;
  const showTrails = showReplayDerived;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-4">
        <button type="button" className={tabCls(sub === 'replay')} onClick={() => setSub('replay')}>
          2D Replay
        </button>
        {showHeatmap && (
          <button type="button" className={tabCls(sub === 'heatmap')} onClick={() => setSub('heatmap')}>
            Heatmap
          </button>
        )}
        {showTrails && (
          <button type="button" className={tabCls(sub === 'trails')} onClick={() => setSub('trails')}>
            Pathing
          </button>
        )}
        {showRecording && (
          <button type="button" className={tabCls(sub === 'recording')} onClick={() => setSub('recording')}>
            Recording
          </button>
        )}
        {sub !== 'recording' && (
          <DevGate className="ml-auto">
            <RegenerateLink matchId={matchId} />
          </DevGate>
        )}
      </div>
      {sub === 'replay' &&
        // Gate on the payload itself (`events`), not `job.status`: if the payload
        // exists we show it even when a later regenerate is queued/running/failed, so
        // a transient dispatch error can't hide a good replay. Only when there's no
        // payload do we fall back to the generate/progress panel (first generation,
        // or genuinely failed before any payload was produced).
        (events ? (
          <div className="lg:grid lg:grid-cols-[auto_1fr] lg:gap-4 lg:items-start">
            <div ref={playerWrapRef}>
              <ReplayPlayer matchId={matchId} jump={jump} onPosition={handlePosition} />
            </div>
            <div className="mt-4 lg:mt-0">
              <SyncedEventsPanel
                events={events}
                active={activeEvent}
                onSeek={seek}
                height={playerHeight}
              />
            </div>
          </div>
        ) : (
          <ReplayStatusPanel job={job} matchId={matchId} canDispatch={canDispatch} />
        ))}
      {sub === 'heatmap' && showHeatmap && matchMap && (
        <MapHeatmap slug={mapSlug(matchMap)} matchIds={thisMatch} visibleMatchIds={visibleMatchIds} />
      )}
      {sub === 'trails' && showTrails && matchMap && events && (
        <MatchPlayerTrails matchId={matchId} matchMap={matchMap} players={events.players} />
      )}
      {sub === 'recording' && showRecording && (
        <div className="mt-4 flex flex-col gap-6">
          <RecordingViewer videoId={recordingURL} />
          {canEditRecording && <RecordingUrlForm matchId={matchId} videoId={recordingURL} />}
        </div>
      )}
    </div>
  );
}

/** Dev-only re-dispatch of a finished replay (re-runs the extract Action, overwrites R2). */
function RegenerateLink({ matchId }: { matchId: number }) {
  const { dispatch, busy, error, isPending } = useReplayDispatch(matchId);
  return (
    <div className="flex items-center gap-2">
      {error && <span className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</span>}
      <button
        type="button"
        onClick={dispatch}
        disabled={busy || isPending}
        className="font-mono text-[11px] text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {busy || isPending ? 'Regenerating…' : 'Regenerate'}
      </button>
    </div>
  );
}
