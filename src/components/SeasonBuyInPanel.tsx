'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatBuyIn, isValidBuyInText } from '@/lib/season-buy-in';
import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { useAsyncAction } from './useAsyncAction';

interface Props {
  seasonId: number;
  buyInAmount: number | null;
  canEdit: boolean;
}

/** An UPCOMING season's buy-in. Admins can change it here until the season's schedule is generated
 * (`canEdit` is false from then on, and the API refuses too). */
export function SeasonBuyInPanel({ seasonId, buyInAmount, canEdit }: Props) {
  const router = useRouter();
  // The in-progress text while editing; `null` when not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const { busy: saving, error, run } = useAsyncAction();
  const [isPending, startTransition] = useTransition();

  async function save() {
    if (draft === null) return;
    await run(async () => {
      const res = await fetch(`/api/seasons/${seasonId}/buy-in`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buy_in_amount: Number(draft) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to save buy-in.');
      }
      setDraft(null);
      startTransition(() => router.refresh());
    });
  }

  const busy = saving || isPending;

  if (draft === null) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          Buy-in: {buyInAmount != null ? formatBuyIn(buyInAmount) : <span className="opacity-60">TBD</span>}
        </span>
        {canEdit && (
          <button
            onClick={() => setDraft(String(buyInAmount ?? 0))}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-w-[240px]">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Buy-in in dollars"
        className="font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
      />
      {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !isValidBuyInText(draft)}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Saving…' : 'Save buy-in'}
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
