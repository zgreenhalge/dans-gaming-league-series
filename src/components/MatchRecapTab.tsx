'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Skull, Bomb, Scissors, Clock, Crosshair } from 'lucide-react';
import { tabCls } from '@/lib/util';
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = job.status === 'queued' || job.status === 'running';

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

function EventRow({
  ev,
  nameOf,
  sideOf,
}: {
  ev: ReplayEvent;
  nameOf: (id: number | null) => string;
  sideOf: (id: number | null) => Side | null;
}) {
  const name = (id: number | null) => <PlayerName id={id} nameOf={nameOf} sideOf={sideOf} />;

  if (ev.type === 'kill') {
    return (
      <li className={`${ROW_BASE} lift-row`}>
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
      </li>
    );
  }
  if (ev.type === 'plant') {
    return (
      <li className={`${ROW_BASE} lift-row`}>
        <Bomb size={13} className="text-[var(--color-text-secondary)] shrink-0" />
        {name(ev.playerId)}
        <span className="text-[var(--color-text-secondary)]">
          planted the bomb{ev.site ? ` on ${ev.site}` : ''}
        </span>
      </li>
    );
  }
  if (ev.type === 'defuse') {
    return (
      <li className={`${ROW_BASE} lift-row`}>
        <Scissors size={13} className="text-[var(--color-text-secondary)] shrink-0" />
        {name(ev.playerId)}
        <span className="text-[var(--color-text-secondary)]">defused the bomb</span>
      </li>
    );
  }
  // round_end
  const Icon =
    ev.condition === 'bomb' ? Bomb : ev.condition === 'defuse' ? Scissors : ev.condition === 'time' ? Clock : Skull;
  const tint = rowTint(ev.winnerSide);
  return (
    <li className={`${ROW_BASE} ${tint.className}`} style={tint.style}>
      <Icon size={13} className="text-[var(--color-text-secondary)] shrink-0" />
      <span className="text-[var(--color-text-secondary)]">Round won by</span>
      <span className="font-semibold" style={{ color: sideColor(ev.winnerSide) }}>
        {ev.winnerFaction ?? ev.winnerSide}
      </span>
    </li>
  );
}

/** The core-events list, grouped by round. */
function EventsList({ events }: { events: ReplayEventsView }) {
  const playerById = new Map(events.players.map((p) => [p.id, p]));
  const nameOf = (id: number | null): string =>
    id === null ? 'world' : (playerById.get(id)?.name ?? `#${id}`);

  return (
    <div className="space-y-5">
      {events.rounds.map((round) => {
        // A player's side this round follows their faction's side assignment.
        const sideOf = (id: number | null): Side | null => {
          if (id === null) return null;
          const faction = playerById.get(id)?.faction;
          if (!faction) return null;
          return round.sideByFaction[faction as Faction];
        };
        return (
          <div key={round.round} className="border border-[var(--color-border-primary)]">
            <div className="bg-[var(--color-bg-secondary)] px-3 py-2 border-b border-[var(--color-border-primary)] flex items-center gap-3">
              <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">
                Round {round.round}
              </span>
            </div>
            <ul>
              {round.events.map((ev, i) => (
                <EventRow key={i} ev={ev} nameOf={nameOf} sideOf={sideOf} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Placeholder until the Phase 2 client `<ReplayPlayer>` lands (issue #121). */
function ReplayPlaceholder() {
  return (
    <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-text-secondary)]">
      The 2D replay player is coming soon.
    </div>
  );
}

type RecapSubTab = 'events' | 'replay';

export default function MatchRecapTab({
  job,
  events,
  matchId,
  canDispatch,
}: {
  job: ReplayJobState;
  events: ReplayEventsView | null;
  matchId: number;
  canDispatch: boolean;
}) {
  const [sub, setSub] = useState<RecapSubTab>('events');

  // Both sub-tabs are powered by the same replay payload — until it's ready, show
  // the generate/progress panel instead of either sub-tab.
  if (job.status !== 'ready' || !events) {
    return <ReplayStatusPanel job={job} matchId={matchId} canDispatch={canDispatch} />;
  }

  return (
    <div className="mt-4">
      <div className="flex gap-2 mb-4">
        <button type="button" className={tabCls(sub === 'events')} onClick={() => setSub('events')}>
          Events
        </button>
        <button type="button" className={tabCls(sub === 'replay')} onClick={() => setSub('replay')}>
          2D Replay
        </button>
      </div>
      {sub === 'events' ? <EventsList events={events} /> : <ReplayPlaceholder />}
    </div>
  );
}
