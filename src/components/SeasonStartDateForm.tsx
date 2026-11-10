'use client';

import { useState } from 'react';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import ErrorText from '@/components/ErrorText';

interface Props {
  seasonId: number;
  startDate: string | null;
  /** Called after a save or clear lands, and on Cancel. */
  onDone: (saved: boolean) => void;
}

/** An admin's editor for an UPCOMING season's start date, opened from `SeasonSetupDetails`' admin
 *  menu: a date, Save, ✕ to clear a set date, and Cancel. */
export function SeasonStartDateForm({ seasonId, startDate, onDone }: Props) {
  const [value, setValue] = useState(startDate ?? '');
  const { busy, error, run } = useAsyncAction();

  function write(start_date: string | null) {
    return run(async () => {
      await sendJsonRequest('PATCH', `/api/seasons/${seasonId}/start-date`, { start_date });
      onDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Start date"
          className="font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
        />
        <button
          type="button"
          onClick={() => write(value)}
          disabled={!value || busy}
          className="tracked text-[10px] font-semibold px-2 py-1.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] disabled:opacity-40 transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {startDate && (
          <button
            type="button"
            onClick={() => write(null)}
            disabled={busy}
            className="text-[11px] text-[var(--color-text-secondary)] hover:text-red-500 transition-colors leading-none disabled:opacity-40"
            title="Clear start date"
            aria-label="Clear start date"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          onClick={() => onDone(false)}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
      <ErrorText error={error} size={12} />
    </div>
  );
}
