'use client';

// Manage -> Season's Discord match-thread publisher (#398) — admin-triggered only, since a season's
// start_date is often arbitrary and so is when an admin actually wants a week's threads posted.
// "Publish Next Week" resolves "next" the same way the home page and `/scheduled` do
// (`findCurrentWeek()`, server-side in `publishWeekThreads()`); the week-number field covers
// publishing an arbitrary past/future week by hand. Results render per match immediately — a channel
// permission overwrite is the likeliest first-attempt failure and needs to be visible right here, not
// only in the Activity feed on a later page load.

import { useState } from 'react';
import { ADMIN_PRIMARY_BUTTON_CLS } from './ArmedConfirmButton';

interface ThreadResult {
  matchId: number;
  title: string;
  status: 'created' | 'skipped' | 'failed';
  detail: string;
}

const STATUS_ICON: Record<ThreadResult['status'], string> = {
  created: '✅',
  skipped: '⏭',
  failed: '❌',
};

export function DiscordThreadPublisher({ seasonId }: { seasonId: number }) {
  const [weekInput, setWeekInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedWeek, setPublishedWeek] = useState<number | null>(null);
  const [results, setResults] = useState<ThreadResult[]>([]);

  async function publish(week: number | 'next') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/discord-threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not publish threads');
        setResults([]);
        setPublishedWeek(null);
        return;
      }
      setPublishedWeek(body.weekNumber ?? null);
      setResults((body.matches ?? []) as ThreadResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const weekNumber = Number(weekInput);
  const weekValid = weekInput.trim() !== '' && Number.isFinite(weekNumber) && weekNumber > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="tracked text-[10px] text-[var(--color-text-secondary)]">Discord Match Threads</div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => publish('next')}
          disabled={busy}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Publishing…' : 'Publish Next Week'}
        </button>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={weekInput}
            onChange={(e) => setWeekInput(e.target.value)}
            placeholder="Week #"
            className="w-20 font-mono text-[13px] px-2 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
          />
          <button
            type="button"
            onClick={() => publish(weekNumber)}
            disabled={busy || !weekValid}
            className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40"
          >
            Publish Week
          </button>
        </div>
      </div>

      {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}

      {results.length > 0 && (
        <div className="flex flex-col gap-1 border border-[var(--color-border-tertiary)] rounded px-3 py-2.5">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1">Week {publishedWeek}</div>
          {results.map((r) => (
            <div key={r.matchId} className="font-mono text-[11px] flex items-baseline gap-2">
              <span>{STATUS_ICON[r.status]}</span>
              <span className="text-[var(--color-text-primary)] shrink-0">{r.title}</span>
              <span className="text-[var(--color-text-secondary)] truncate">{r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
