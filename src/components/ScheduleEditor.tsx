'use client';

// Compact schedule editor for the admin match console (#144). Presentation only — the edit-state
// machine, window/collision warnings, and save/clear all live in the shared `useScheduleEditor` hook
// (the match-page hero renders its own markup off the same hook).

import Link from 'next/link';
import type { ScheduledMatchRef } from '@/lib/schedule';
import { useScheduleEditor } from './useScheduleEditor';

function fmtScheduled(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduleEditor({
  matchId,
  scheduledAt,
  weekStart,
  weekEnd,
  otherScheduled,
}: {
  matchId: number;
  scheduledAt: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  otherScheduled: ScheduledMatchRef[];
}) {
  const s = useScheduleEditor({ matchId, scheduledAt, weekStart, weekEnd, otherScheduled });

  if (!s.editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {scheduledAt ? (
          <span className="font-mono text-[12px] text-[var(--color-text-primary)]">{fmtScheduled(scheduledAt)}</span>
        ) : (
          <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">unscheduled</span>
        )}
        <button
          onClick={s.startEditing}
          className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {scheduledAt ? 'Edit' : 'Set time'}
        </button>
        {s.error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{s.error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="datetime-local"
          value={s.value}
          onChange={(e) => s.setValue(e.target.value)}
          className="font-mono text-[12px] px-2 py-1 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)] rounded"
        />
        <button
          onClick={() => s.save()}
          disabled={!s.value || s.saving}
          className="font-mono text-[10px] px-2 py-[3px] rounded border border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] disabled:opacity-40 transition-colors"
        >
          Save
        </button>
        {scheduledAt && (
          <button
            onClick={s.clear}
            title="Clear scheduled time"
            aria-label="Clear scheduled time"
            className="font-mono text-[13px] leading-none text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors"
          >
            ✕
          </button>
        )}
        <button
          onClick={s.cancel}
          className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>

      {s.warning && (
        <div className="border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] px-3 py-2 flex flex-col gap-2 rounded">
          <span className="font-mono text-[11px] text-[var(--color-accent-amber-fg)]">
            {s.warning === 'collision' ? (
              <>
                Within an hour of{' '}
                {s.collisionWith ? (
                  <Link href={`/matches/${s.collisionWith.id}`} className="underline hover:opacity-80">
                    {s.collisionWith.label}
                  </Link>
                ) : (
                  'another match'
                )}{' '}
                — they share one game server and may contend.
              </>
            ) : (
              'Outside the week window.'
            )}
          </span>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => s.save(true)}
              className="font-mono text-[10px] font-semibold px-2 py-1 rounded border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] transition-colors"
            >
              Schedule anyway
            </button>
            <button
              onClick={s.dismissWarning}
              className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {s.error && <span className="font-mono text-[10px] text-[var(--color-accent-red-fg)]">{s.error}</span>}
    </div>
  );
}
