'use client';

// Manage -> Season's Discord thread publisher (#398) — admin-triggered only, since a season's
// start_date is often arbitrary and so is when an admin actually wants threads posted.
// "Publish Next Week/Round" resolves "next" as the first period with no played matches yet
// (`findNextUnplayedWeek()`/gauntlet's own resolution, server-side in `publishWeekThreads()`/
// `publishPodThreads()`) — deliberately not the home page / `/scheduled` calendar-current week,
// since out-of-order match entry can put those on a different period than the one that still needs
// threads. The number field covers publishing an arbitrary past/future period by hand. A regular
// season publishes one thread per match; a gauntlet season (`periodLabel="Round"`) publishes one per
// pod, covering both its games. Results render immediately — a channel permission overwrite is the
// likeliest first-attempt failure and needs to be visible right here, not only in the Activity feed
// on a later page load. Closing a thread once its match(es) are played happens separately, from the
// score route (`closeMatchThread()`/`closeGauntletPodThreadIfDone()`), not from here.

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

export function DiscordThreadPublisher({ seasonId, periodLabel = 'Week' }: { seasonId: number; periodLabel?: 'Week' | 'Round' }) {
  const [periodInput, setPeriodInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedPeriod, setPublishedPeriod] = useState<number | null>(null);
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
        setPublishedPeriod(null);
        return;
      }
      // A regular season's response carries weekNumber/matches; a gauntlet's carries
      // roundNumber/pods (publishWeekThreads()/publishPodThreads()) — read whichever is present
      // rather than branching on periodLabel, so the two response shapes can't drift out of sync
      // with this component's own prop.
      setPublishedPeriod(body.weekNumber ?? body.roundNumber ?? null);
      setResults((body.matches ?? body.pods ?? []) as ThreadResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const periodNumber = Number(periodInput);
  const periodValid = periodInput.trim() !== '' && Number.isFinite(periodNumber) && periodNumber > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="tracked text-[10px] text-[var(--color-text-secondary)]">Discord {periodLabel === 'Round' ? 'Pod' : 'Match'} Threads</div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => publish('next')}
          disabled={busy}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Publishing…' : `Publish Next ${periodLabel}`}
        </button>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={periodInput}
            onChange={(e) => setPeriodInput(e.target.value)}
            placeholder={`${periodLabel} #`}
            className="w-20 font-mono text-[13px] px-2 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
          />
          <button
            type="button"
            onClick={() => publish(periodNumber)}
            disabled={busy || !periodValid}
            className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors disabled:opacity-40"
          >
            Publish {periodLabel}
          </button>
        </div>
      </div>

      {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}

      {results.length > 0 && (
        <div className="flex flex-col gap-1 border border-[var(--color-border-tertiary)] rounded px-3 py-2.5">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-1">{periodLabel} {publishedPeriod}</div>
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
