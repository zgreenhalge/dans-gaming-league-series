'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toSentenceCase, mapSlug } from '@/lib/maps';
import { formatCountdownRelative, fmtWindowDay } from '@/lib/util';
import { type ScheduledMatchRef } from '@/lib/server-schedule-collision';
import { useScheduleEditor } from './useScheduleEditor';
import { useHasMounted } from './useHasMounted';
import { ScheduleWarningBox } from './ScheduleWarning';
import ErrorText from '@/components/ErrorText';

interface Props {
  map: string | null;
  matchId: number;
  scheduledAt: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  canEdit: boolean;
  played: boolean;
  /** The pod's other game, for the cross-link under the map name — null for a non-gauntlet match or
   *  one with no resolvable pod sibling. */
  podSibling?: { matchId: number; gameNumber: number } | null;
  /** Other unplayed scheduled matches — drives the shared-server collision warning (#134). */
  otherScheduled?: ScheduledMatchRef[];
}

function useCountdown(iso: string | null): string {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!iso) return;

    const tick = () => {
      const target = new Date(iso).getTime();
      if (target <= Date.now()) {
        setLabel('');
        return false;
      }
      setLabel(formatCountdownRelative(iso));
      return true;
    };

    if (!tick()) return;
    const id = setInterval(() => { if (!tick()) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return label;
}

function fmtScheduled(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MatchHeaderSection({
  map,
  matchId,
  scheduledAt,
  weekStart,
  weekEnd,
  canEdit,
  played,
  podSibling = null,
  otherScheduled = [],
}: Props) {
  const isClient = useHasMounted();
  const countdown = useCountdown(scheduledAt);
  const {
    editing,
    value,
    warning,
    collisionWith,
    error,
    setValue,
    startEditing,
    cancel,
    dismissWarning,
    save,
    clear,
  } = useScheduleEditor({ matchId, scheduledAt, weekStart, weekEnd, otherScheduled });

  const windowLabel =
    isClient && weekStart && weekEnd ? `${fmtWindowDay(weekStart)} – ${fmtWindowDay(weekEnd)}` : null;

  const scheduleReadView = !editing && (
    <div className="flex items-center gap-2">
      {scheduledAt ? (
        canEdit ? (
          <div>
            <button
              onClick={startEditing}
              className="map-text-scrim font-display text-[28px] font-semibold leading-tight text-[var(--color-text-primary)] hover:underline transition-colors"
            >
              {isClient ? fmtScheduled(scheduledAt) : null}
            </button>
            {countdown && (
              <div className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)] mt-1">
                {countdown}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="map-text-scrim font-display text-[28px] font-semibold leading-tight text-[var(--color-text-primary)]">
              {isClient ? fmtScheduled(scheduledAt) : null}
            </div>
            {countdown && (
              <div className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)] mt-1">
                {countdown}
              </div>
            )}
          </div>
        )
      ) : windowLabel ? (
        <span className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)]">
          {windowLabel}
        </span>
      ) : null}
      {canEdit && !scheduledAt && (
        <button
          onClick={startEditing}
          className="map-text-scrim tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
        >
          Set time
        </button>
      )}
    </div>
  );

  const scheduleEditView = canEdit && editing && (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
      />
      <button
        onClick={() => save()}
        disabled={!value}
        className="tracked text-[10px] font-semibold px-2 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-40 transition-colors"
      >
        Save
      </button>
      {scheduledAt && (
        <button
          onClick={clear}
          className="text-[11px] text-[var(--color-text-secondary)] hover:text-red-500 transition-colors leading-none"
          title="Clear scheduled time"
        >
          ✕
        </button>
      )}
      <button
        onClick={cancel}
        className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  const rightContent = (
    <div className="text-right">
      <div className="map-text-scrim font-display text-[36px] font-semibold leading-tight">
        {map ? (
          <Link href={`/maps/${mapSlug(map)}`} className="hover:underline">
            {toSentenceCase(map)}
          </Link>
        ) : 'TBD'}
      </div>
      {podSibling && (
        <div className="mt-1">
          <Link
            href={`/matches/${podSibling.matchId}`}
            className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
          >
            Go to Game {podSibling.gameNumber}
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* ── Header row: Pending + schedule controls (left) + map/week info (right) ── */}
      <div className={`flex items-end gap-4 flex-wrap ${!played ? 'justify-between' : 'justify-end'}`}>
        {!played && (
          <div className="flex flex-col items-start gap-1.5">
            {scheduleReadView}
            {scheduleEditView}
          </div>
        )}
        {rightContent}
      </div>

      {/* ── Warning row: only appears here, never inside the header row ─────── */}
      {!played && warning && (
        <div className="flex justify-start">
          <ScheduleWarningBox
            warning={warning}
            collisionWith={collisionWith}
            windowMessage={`Outside week window${windowLabel ? ` (${windowLabel})` : ''}.`}
            onScheduleAnyway={() => save(true)}
            onDismiss={dismissWarning}
            variant="hero"
          />
        </div>
      )}

      <ErrorText error={error} size={12} />
    </div>
  );
}
