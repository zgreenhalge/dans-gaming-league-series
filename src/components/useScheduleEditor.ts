'use client';

// Shared schedule-edit logic for a match (#144 admin console + the in-match `MatchHeaderSection`
// hero). One place for the edit-state machine, the week-window / shared-server-collision warnings,
// and the save/clear PATCHes to `/schedule`, so the match page and the console can't drift. Each
// surface renders its own markup (hero vs compact row) off this hook.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { findScheduleCollision, type ScheduledMatchRef } from '@/lib/schedule';

/** ISO → the `datetime-local` input value in the viewer's local time. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function isOutsideWindow(localDt: string, weekStart: string | null, weekEnd: string | null): boolean {
  if (!weekStart || !weekEnd || !localDt) return false;
  const d = new Date(localDt);
  return d < new Date(weekStart + 'T00:00:00') || d > new Date(weekEnd + 'T23:59:59');
}

export type ScheduleWarning = 'window' | 'collision' | null;

export interface ScheduleEditor {
  editing: boolean;
  value: string;
  warning: ScheduleWarning;
  collisionWith: ScheduledMatchRef | null;
  error: string | null;
  saving: boolean;
  /** Feed the raw `datetime-local` string; snaps to the nearest 15 minutes. */
  setValue: (raw: string) => void;
  startEditing: () => void;
  cancel: () => void;
  dismissWarning: () => void;
  save: (override?: boolean) => void;
  clear: () => void;
}

export function useScheduleEditor(opts: {
  matchId: number;
  scheduledAt: string | null;
  weekStart?: string | null;
  weekEnd?: string | null;
  /** Other unplayed scheduled matches — drives the shared-server collision warning (#134). */
  otherScheduled?: ScheduledMatchRef[];
}): ScheduleEditor {
  const { matchId, scheduledAt, weekStart = null, weekEnd = null, otherScheduled = [] } = opts;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValueState] = useState('');
  const [warning, setWarning] = useState<ScheduleWarning>(null);
  const [collisionWith, setCollisionWith] = useState<ScheduledMatchRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  // Keep the field in sync when the underlying schedule changes (e.g. another client edits it).
  useEffect(() => {
    if (scheduledAt) setValueState(toDatetimeLocal(scheduledAt));
  }, [scheduledAt]);

  const setValue = (raw: string) => {
    if (!raw) {
      setValueState('');
      setWarning(null);
      return;
    }
    const d = new Date(raw);
    d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setValueState(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    setWarning(null);
  };

  const startEditing = () => {
    setValueState(scheduledAt ? toDatetimeLocal(scheduledAt) : '');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setWarning(null);
    setError(null);
  };

  const dismissWarning = () => setWarning(null);

  async function save(override = false) {
    if (!value) return;
    if (!override) {
      if (isOutsideWindow(value, weekStart, weekEnd)) {
        setWarning('window');
        return;
      }
      const clash = findScheduleCollision(value, otherScheduled);
      if (clash) {
        setCollisionWith(clash);
        setWarning('collision');
        return;
      }
    }
    setWarning(null);
    setError(null);
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setError(null);
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  }

  return {
    editing,
    value,
    warning,
    collisionWith,
    error,
    saving,
    setValue,
    startEditing,
    cancel,
    dismissWarning,
    save,
    clear,
  };
}
