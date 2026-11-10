'use client';

import { useState } from 'react';
import { parseBuyInText } from '@/lib/season-buy-in';
import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import ErrorText from '@/components/ErrorText';

interface Props {
  seasonId: number;
  buyInAmount: number | null;
  /** Called after a save lands, and on Cancel. */
  onDone: (saved: boolean) => void;
}

/** An admin's editor for an UPCOMING season's buy-in, opened from `SeasonSetupDetails`' admin menu
 *  until the season's schedule is generated (the API refuses after that too). Blank saves as TBD. */
export function SeasonBuyInForm({ seasonId, buyInAmount, onDone }: Props) {
  const [draft, setDraft] = useState(buyInAmount != null ? String(buyInAmount) : '');
  const { busy, error, run } = useAsyncAction();
  const input = parseBuyInText(draft);

  function save() {
    if (!input.ok) return;
    return run(async () => {
      await sendJsonRequest('PATCH', `/api/seasons/${seasonId}/buy-in`, { buy_in_amount: input.amount });
      onDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-2 max-w-[240px]">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="TBD"
        aria-label="Buy-in in dollars (blank for TBD)"
        className="font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
      />
      <ErrorText error={error} size={12} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !input.ok}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Saving…' : 'Save buy-in'}
        </button>
        <button
          type="button"
          onClick={() => onDone(false)}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
