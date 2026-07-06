'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toSentenceCase, mapSlug } from '@/lib/maps';
import { type ScheduledMatchRef } from '@/lib/schedule';
import { useScheduleEditor } from './useScheduleEditor';
import { useHasMounted } from './useHasMounted';

interface Props {
  map: string | null;
  matchId: number;
  scheduledAt: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  canEdit: boolean;
  played: boolean;
  isGauntlet: boolean;
  /** Other unplayed scheduled matches — drives the shared-server collision warning (#134). */
  otherScheduled?: ScheduledMatchRef[];
}

function formatCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const s = Math.floor(abs / 1000) % 60;
  const m = Math.floor(abs / 60_000) % 60;
  const h = Math.floor(abs / 3_600_000) % 24;
  const d = Math.floor(abs / 86_400_000);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return past ? `${parts.join(' ')} ago` : `in ${parts.join(' ')}`;
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
      setLabel(formatCountdown(iso));
      return true;
    };

    if (!tick()) return;
    const id = setInterval(() => { if (!tick()) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return label;
}

function fmtWindowDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
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
  isGauntlet,
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

  const showSchedule = !played && !isGauntlet;
  const windowLabel =
    isClient && weekStart && weekEnd ? `${fmtWindowDate(weekStart)} – ${fmtWindowDate(weekEnd)}` : null;

  const scheduleReadView = showSchedule && !editing && (
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

  const scheduleEditView = showSchedule && editing && (
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
      {showSchedule && warning && (
        <div className="flex justify-start">
          <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] px-3 py-2.5 flex flex-col gap-2">
            <span className="text-[12px] text-[var(--color-accent-amber-fg)]">
              {warning === 'collision' ? (
                <>
                  Within an hour of{' '}
                  {collisionWith ? (
                    <Link href={`/matches/${collisionWith.id}`} className="underline hover:opacity-80">
                      {collisionWith.label}
                    </Link>
                  ) : (
                    'another match'
                  )}{' '}
                  — they share one game server and may contend.
                </>
              ) : (
                `Outside week window${windowLabel ? ` (${windowLabel})` : ''}.`
              )}
            </span>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => save(true)}
                className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] transition-colors"
              >
                Schedule anyway
              </button>
              <button
                onClick={dismissWarning}
                className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex justify-start text-[12px] text-[var(--color-accent-red-fg, #f87171)]">
          {error}
        </div>
      )}
    </div>
  );
}
