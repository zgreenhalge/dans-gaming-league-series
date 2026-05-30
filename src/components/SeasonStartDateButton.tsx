'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  seasonId: number;
  startDate: string | null;
  canEdit: boolean;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SeasonStartDateButton({ seasonId, startDate, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(startDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function save() {
    if (!value) return;
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/start-date`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: value }),
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
    const res = await fetch(`/api/seasons/${seasonId}/start-date`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Failed to clear.');
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  if (!editing) {
    if (!canEdit && !startDate) return null;
    return (
      <div className="flex items-center gap-3 flex-wrap">
        {startDate && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              {fmtDate(startDate)}
            </span>
            {canEdit && (
              <button
                onClick={clear}
                className="text-[11px] text-[var(--color-text-secondary)] hover:text-red-500 transition-colors leading-none"
                title="Clear start date"
              >
                ✕
              </button>
            )}
          </div>
        )}
        {canEdit && (
          <button
            onClick={() => {
              setValue(startDate ?? '');
              setEditing(true);
            }}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
          >
            {startDate ? 'Edit' : 'Set start date'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
        <button
          onClick={save}
          disabled={!value}
          className="tracked text-[10px] font-semibold px-2 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-40 transition-colors"
        >
          Save
        </button>
        {startDate && (
          <button
            onClick={clear}
            className="text-[11px] text-[var(--color-text-secondary)] hover:text-red-500 transition-colors leading-none"
            title="Clear start date"
          >
            ✕
          </button>
        )}
        <button
          onClick={() => { setEditing(false); setError(null); }}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="text-[12px] text-[var(--color-accent-red-fg, #f87171)]">{error}</div>
      )}
    </div>
  );
}
