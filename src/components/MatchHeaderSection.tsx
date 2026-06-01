'use client';

import { useState, useTransition, useEffect } from 'react';
import { toSentenceCase } from '@/lib/maps';
import { useRouter } from 'next/navigation';

interface Props {
  map: string | null;
  matchId: number;
  scheduledAt: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  canEdit: boolean;
  played: boolean;
  isGauntlet: boolean;
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
    if (new Date(iso).getTime() <= Date.now()) return;
    setLabel(formatCountdown(iso));
    const id = setInterval(() => {
      if (new Date(iso).getTime() <= Date.now()) { setLabel(''); clearInterval(id); return; }
      setLabel(formatCountdown(iso));
    }, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return label;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
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

function isOutsideWindow(localDt: string, weekStart: string | null, weekEnd: string | null): boolean {
  if (!weekStart || !weekEnd || !localDt) return false;
  const d = new Date(localDt);
  return d < new Date(weekStart + 'T00:00:00') || d > new Date(weekEnd + 'T23:59:59');
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
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(scheduledAt ? toDatetimeLocal(scheduledAt) : '');
  const [warning, setWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const countdown = useCountdown(scheduledAt);

  const showSchedule = !played && !isGauntlet;
  const windowLabel =
    weekStart && weekEnd ? `${fmtWindowDate(weekStart)} – ${fmtWindowDate(weekEnd)}` : null;

  async function save(override = false) {
    if (!value) return;
    if (!override && isOutsideWindow(value, weekStart, weekEnd)) {
      setWarning(true);
      return;
    }
    setWarning(false);
    setError(null);
    const res = await fetch(`/api/matches/${matchId}/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_at: new Date(value).toISOString() }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to save.');
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  async function clear() {
    setError(null);
    const res = await fetch(`/api/matches/${matchId}/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_at: null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to clear.');
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  const startEditing = () => { setValue(scheduledAt ? toDatetimeLocal(scheduledAt) : ''); setEditing(true); };

  const scheduleReadView = showSchedule && !editing && (
    <div className="flex items-center gap-2">
      {scheduledAt ? (
        canEdit ? (
          <div>
            <button
              suppressHydrationWarning
              onClick={startEditing}
              className="map-text-scrim font-display text-[28px] font-semibold leading-tight text-[var(--color-text-primary)] hover:underline transition-colors"
            >
              {fmtScheduled(scheduledAt)}
            </button>
            <div suppressHydrationWarning className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)] mt-1">
              {countdown}
            </div>
          </div>
        ) : (
          <div>
            <div suppressHydrationWarning className="map-text-scrim font-display text-[28px] font-semibold leading-tight text-[var(--color-text-primary)]">
              {fmtScheduled(scheduledAt)}
            </div>
            <div suppressHydrationWarning className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)] mt-1">
              {countdown}
            </div>
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
        onChange={(e) => {
          if (!e.target.value) { setValue(''); setWarning(false); return; }
          const d = new Date(e.target.value);
          d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
          const pad = (n: number) => String(n).padStart(2, '0');
          setValue(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
          setWarning(false);
        }}
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
        onClick={() => { setEditing(false); setWarning(false); setError(null); }}
        className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  const rightContent = (
    <div className="text-right">
      <div className="map-text-scrim font-display text-[36px] font-semibold leading-tight">
        {map ? toSentenceCase(map) : 'TBD'}
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
              Outside week window{windowLabel ? ` (${windowLabel})` : ''}.
            </span>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => save(true)}
                className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] transition-colors"
              >
                Schedule anyway
              </button>
              <button
                onClick={() => setWarning(false)}
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
