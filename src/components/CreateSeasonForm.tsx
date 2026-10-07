'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { MapPoolPicker, useMapPoolSelection } from './MapPoolPicker';

interface Props {
  knownMaps: string[];
}

/** The map pool is optional here — a season can open for signups before its maps are decided, and
 * is set later from the season page (`SeasonMapPoolPanel`). */
export function CreateSeasonForm({ knownMaps }: Props) {
  const router = useRouter();
  const selection = useMapPoolSelection();
  const [buyIn, setBuyIn] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_pool: selection.mapPool, new_maps: selection.newMaps, buy_in_amount: Number(buyIn) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to create season.');
        return;
      }
      const created = await res.json();
      router.refresh();
      startTransition(() => router.push(`/seasons/${created.id}`));
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || isPending;
  const buyInValid = buyIn.trim() !== '' && Number.isFinite(Number(buyIn)) && Number(buyIn) >= 0;

  return (
    <div className="flex flex-col gap-8">
      <label className="flex flex-col gap-1.5 max-w-[200px]">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Buy-in ($)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={buyIn}
          onChange={(e) => setBuyIn(e.target.value)}
          className="font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
      </label>

      <MapPoolPicker knownMaps={knownMaps} selection={selection} />

      <div className="flex flex-col gap-3">
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          Leave the map pool empty to open signups now and pick maps later.
        </div>
        {error && (
          <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !selection.isValid || !buyInValid}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40 self-start`}
        >
          {busy ? 'Creating…' : 'Create Season'}
        </button>
      </div>
    </div>
  );
}
