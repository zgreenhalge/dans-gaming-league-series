'use client';

// The unified admin console's Activity feed (issue #262): every background job and every live
// ops_errors row, merged into one newest-first list, tagged Errored / In Progress / Completed rather
// than split into separate tabs — a status is just another thing to filter by, not a reason to
// partition the view, so the tag filter chips sit alongside the existing type/range chips and any
// combination narrows the same list. Fixed-height scrollable panel, narrowed by tag/type/range filters
// rather than pre-collapsed into groups — filters stay useful regardless of how a burst of activity is
// distributed, where a grouping heuristic only helps the shapes it was tuned for.
//
// A job sitting "in progress" past `STALE_IN_FLIGHT_MS` (jobIsStale(), src/lib/jobs.ts) tags as
// Errored instead — a GitHub Actions run that dies without writing a terminal status (a hard
// timeout, a manual cancel, a lost runner) otherwise leaves its row silently parked "in progress"
// indefinitely, with nothing on this feed ever calling attention to it.
//
// Job row actions reuse the same per-pipeline islands the old JobsDashboard used
// (`IngestJobActions`, `JobRetryButton`) — only the tagging here is new, not the mutations.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtUtcShort, tabCls } from '@/lib/util';
import EmptyState from './EmptyState';
import TabBar from './TabBar';
import {
  BACKGROUND_JOB_TYPES,
  JOB_TYPE_LABEL,
  JOB_IN_PROGRESS_STATUSES,
  jobNeedsAttention,
  jobIsStale,
  jobDurationLabel,
  type BackgroundJobRow,
  type BackgroundJobType,
} from '@/lib/jobs';
import { IngestJobActions } from './IngestJobActions';
import { JobRetryButton, JobsLiveRefresh } from './JobActions';
import { OPERATION_LABELS, dismissOpsError, retryEndpointFor, type OpsErrorItem } from './OpsErrorList';
import type { OpsErrorHistoryRow } from '@/lib/queries';

type View = 'events' | 'history';
type Tag = 'errored' | 'progress' | 'completed';
type TypeFilter = 'all' | BackgroundJobType;
type RangeFilter = 'all' | '30m' | '1h' | '6h' | '12h' | '24h';

/** A job row's tag/staleness depends on `now` (a 60s-refreshed tick); everything else about it
 *  doesn't — kept as its own shape so recomputing tag/staleness each tick is a cheap re-map over
 *  `JobEventBase`s rather than rebuilding and re-sorting the whole event list. */
interface JobEventBase {
  kind: 'job';
  key: string;
  job: BackgroundJobRow;
  when: string | null;
  ts: number | null;
}
interface JobEvent extends JobEventBase {
  tag: Tag;
  stale: boolean;
}
interface OpsEvent {
  kind: 'ops';
  key: string;
  err: OpsErrorItem;
  tag: Tag;
  when: string | null;
  ts: number | null;
}
type BaseEvent = JobEventBase | OpsEvent;
type Event = JobEvent | OpsEvent;

function jobTag(job: BackgroundJobRow, stale: boolean): Tag {
  if (jobNeedsAttention(job) || stale) return 'errored';
  if (JOB_IN_PROGRESS_STATUSES.has(job.status)) return 'progress';
  return 'completed';
}

function toTs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function matchesFilter(e: Event, filter: TypeFilter): boolean {
  if (filter === 'all') return true;
  if (e.kind === 'ops') return false;
  return e.job.jobType === filter;
}

function matchesTag(e: Event, tags: Set<Tag>): boolean {
  return tags.has(e.tag);
}

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

function matchesRange(e: Event, range: RangeFilter, now: number | null): boolean {
  if (range === 'all') return true;
  if (now === null) return false;
  if (e.ts === null) return true;
  return now - e.ts <= RANGE_MS[range];
}

/** One filter chip, the same shape whether it's narrowing by job type or by time range. */
function FilterChip<T extends string>({ value, label, active, onClick }: {
  value: T;
  label: string;
  active: boolean;
  onClick: (value: T) => void;
}) {
  return (
    <button
      onClick={() => onClick(value)}
      aria-pressed={active}
      className={`font-mono text-[11px] px-2.5 py-1 rounded border transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-text-primary)] bg-[var(--color-accent-blue-bg)]'
          : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {label}
    </button>
  );
}

/** The four accent tones every status/tag badge on this feed renders in — one string per tone, so
 *  `StatusPill` and `TagBadge` (below) share the same palette instead of each hand-typing the same
 *  `bg-…/text-…/border-…` triples. */
const TONE_CLS = {
  red: 'bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] border-[var(--color-accent-red-border)]',
  amber: 'bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)] border-[var(--color-accent-amber-border)]',
  blue: 'bg-[var(--color-accent-blue-bg)] text-[var(--color-accent-blue-fg)] border-[var(--color-accent-blue-border)]',
  green: 'bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] border-[var(--color-accent-green-border)]',
} as const;

function StatusPill({ status }: { status: string }) {
  const failed = status === 'failed';
  const review = status === 'parsed' || status === 'quarantined';
  const progress = JOB_IN_PROGRESS_STATUSES.has(status);
  const cls = failed ? TONE_CLS.red : review ? TONE_CLS.amber : progress ? TONE_CLS.blue : TONE_CLS.green;
  return (
    <span className={`inline-block font-mono text-[10px] px-2 py-[2px] rounded border whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}

const TAG_LABEL: Record<Tag, string> = { errored: 'Errored', progress: 'In Progress', completed: 'Completed' };
const TAG_ORDER: Tag[] = ['errored', 'progress', 'completed'];
const TAG_CLS: Record<Tag, string> = { errored: TONE_CLS.red, progress: TONE_CLS.blue, completed: TONE_CLS.green };

/** The status tag every event carries — what used to be three separate tabs (Errored / In Progress /
 *  Completed) is now one of these per row, so the tag filter chips below narrow a single list instead
 *  of switching between views. */
function TagBadge({ tag }: { tag: Tag }) {
  return (
    <span className={`inline-block font-mono text-[10px] uppercase tracking-wide px-1.5 py-[1px] rounded border whitespace-nowrap ${TAG_CLS[tag]}`}>
      {TAG_LABEL[tag]}
    </span>
  );
}

function TypeBadge({ jobType }: { jobType: BackgroundJobType }) {
  return (
    <span className="inline-block font-mono text-[10px] uppercase tracking-wide px-1.5 py-[1px] rounded border border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]">
      {JOB_TYPE_LABEL[jobType]}
    </span>
  );
}

/** The per-pipeline action island for a job row — demo gets confirm/dismiss/re-parse, replay/radar
 *  retry. `stale` lets a job stuck "in progress" past `STALE_IN_FLIGHT_MS` still be retried instead
 *  of reading "working…" forever — the dispatch routes' own guard (`isJobInFlight`,
 *  `src/lib/background-jobs.ts`) already treats it the same way. */
function JobRowActions({ job, stale }: { job: BackgroundJobRow; stale: boolean }) {
  const { subject } = job;
  if (job.jobType === 'demo_ingest' && subject.kind === 'match') {
    return <IngestJobActions matchId={subject.matchId} status={job.status} hasPayload={job.hasPayload} stale={stale} />;
  }
  const inProgress = JOB_IN_PROGRESS_STATUSES.has(job.status) && !stale;
  if (job.jobType === 'replay_extract' && subject.kind === 'match') {
    return <JobRetryButton dispatchUrl={`/api/matches/${subject.matchId}/replay/dispatch`} inProgress={inProgress} />;
  }
  if (job.jobType === 'radar_build' && subject.kind === 'map') {
    return <JobRetryButton dispatchUrl={`/api/maps/${subject.slug}/radar/dispatch`} inProgress={inProgress} />;
  }
  return null;
}

function DismissOpsError({ id, onDismissed }: { id: number; onDismissed: () => void }) {
  const [busy, setBusy] = useState(false);
  async function dismiss() {
    setBusy(true);
    try {
      const result = await dismissOpsError(id);
      if (result.ok) onDismissed();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={busy}
      className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors disabled:opacity-40"
    >
      {busy ? 'Dismissing…' : 'Dismiss'}
    </button>
  );
}

function JobEventRow({ event, now }: { event: JobEvent; now: number | null }) {
  const { job, stale } = event;
  const durationLabel = jobDurationLabel(job, now);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-start px-3 py-2.5 border-t border-[var(--color-border-tertiary)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TagBadge tag={event.tag} />
          <TypeBadge jobType={job.jobType} />
          <StatusPill status={job.status} />
          <Link href={job.subject.href} className="font-display text-[13px] font-semibold hover:underline truncate">
            {job.subject.label}
          </Link>
        </div>
        {job.errorMessage && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words">{job.errorMessage}</div>
        )}
        {stale && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words">
            ⚠ No update in {durationLabel ?? 'a long time'} — the GitHub Action likely finished without
            reporting back. Retrying will start a fresh run.
          </div>
        )}
        {job.quarantineFlags.map((f, i) => (
          <div key={`q${i}`} className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 break-words">
            ⚠ {f}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1 text-right shrink-0">
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums">{event.when ?? '—'}</span>
        {durationLabel && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums">{durationLabel}</span>
        )}
        <div className="flex items-center gap-2">
          {job.ghRunUrl && (
            <a
              href={job.ghRunUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-[var(--color-accent-blue-fg)] hover:underline"
            >
              action log ↗
            </a>
          )}
          <JobRowActions job={job} stale={stale} />
        </div>
      </div>
    </div>
  );
}

function OpsEventRow({ event, onJump, onDismissed }: {
  event: OpsEvent;
  onJump: (type: 'match' | 'player' | 'season', query: string) => void;
  onDismissed: (id: number) => void;
}) {
  const { err } = event;
  const jumpType = err.entityType === 'system' ? null : err.entityType;
  const retryUrl = retryEndpointFor(err);
  return (
    <div className="px-3 py-2.5 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <TagBadge tag={event.tag} />
            <span className="inline-block font-mono text-[10px] uppercase tracking-wide px-1.5 py-[1px] rounded border border-[var(--color-accent-red-border)] text-[var(--color-accent-red-fg)]">
              ops error
            </span>
            <span className="font-display text-[13px] font-semibold truncate">{err.label}</span>
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
              {OPERATION_LABELS[err.operation] ?? err.operation}
            </span>
          </div>
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words max-w-[520px]">
            {err.message}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums">
            {fmtUtcShort(err.occurredAt) ?? '—'}
          </span>
          <div className="flex items-center gap-2">
            {jumpType && (
              <button
                type="button"
                onClick={() => onJump(jumpType, err.label)}
                className="font-mono text-[10px] text-[var(--color-accent-blue-fg)] hover:underline"
              >
                Open in Manage
              </button>
            )}
            {retryUrl && <JobRetryButton dispatchUrl={retryUrl} inProgress={false} />}
            <DismissOpsError id={err.id} onDismissed={() => onDismissed(err.id)} />
          </div>
        </div>
      </div>
    </div>
  );
}

const TAG_FILTERS: { value: Tag; label: string }[] = TAG_ORDER.map((value) => ({ value, label: TAG_LABEL[value] }));

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...BACKGROUND_JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABEL[t] })),
];

const RANGE_FILTERS: { value: RangeFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: '24h' },
  { value: '12h', label: '12h' },
  { value: '6h', label: '6h' },
  { value: '1h', label: '1h' },
  { value: '30m', label: '30m' },
];

/** History tab (#343): a flat, week-grouped count of every `ops_errors` row (dismissed or still
 * live) from `getOpsErrorHistory()` — enough to spot a pattern of intermittent failures across
 * weeks, without duplicating the Errored tier's per-row detail. */
function HistoryTable({ rows }: { rows: OpsErrorHistoryRow[] }) {
  if (rows.length === 0) {
    return <EmptyState size="lg" message="No failure history in the last 8 weeks." />;
  }
  return (
    <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden max-h-[520px] overflow-y-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-[var(--color-border-tertiary)]">
            <th className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] px-3 py-2">Week Of</th>
            <th className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] px-3 py-2">Operation</th>
            <th className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] px-3 py-2 text-right">Failures</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.weekStart}:${r.operation}`} className="border-t border-[var(--color-border-tertiary)]">
              <td className="font-mono text-[11px] text-[var(--color-text-secondary)] px-3 py-2 tabular-nums">{r.weekStart}</td>
              <td className="font-display text-[13px] px-3 py-2">{OPERATION_LABELS[r.operation] ?? r.operation}</td>
              <td className="font-mono text-[13px] px-3 py-2 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminActivityFeed({
  jobs,
  opsErrors,
  opsErrorHistory,
  onJump,
}: {
  jobs: BackgroundJobRow[];
  opsErrors: OpsErrorItem[];
  opsErrorHistory: OpsErrorHistoryRow[];
  onJump: (type: 'match' | 'player' | 'season', query: string) => void;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const liveOpsErrors = useMemo(() => opsErrors.filter((e) => !dismissed.has(e.id)), [opsErrors, dismissed]);

  // `Date.now()` can't be read during render (impure) — track it in state, refreshed periodically, so
  // the range filter (30m/1h/…) and the stale-job check have a "now" to compare against without one.
  // `null` until the first tick means a non-"all" range filters out everything (rather than
  // incorrectly matching everything) and a job in progress never misreads as stale before then.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  // Sorted independently of `now` — a job's tag/staleness ticks every 60s, but that's no reason to
  // rebuild + re-sort the whole merged list every tick when `jobs`/`liveOpsErrors` haven't changed.
  const sortedBase = useMemo<BaseEvent[]>(() => {
    const jobEvents: JobEventBase[] = jobs.map((job) => ({
      kind: 'job',
      key: `job:${job.jobType}:${job.subject.kind === 'match' ? job.subject.matchId : job.subject.mapId}`,
      job,
      when: fmtUtcShort(job.updatedAt),
      ts: toTs(job.updatedAt),
    }));
    const opsEvents: OpsEvent[] = liveOpsErrors.map((err) => ({
      kind: 'ops',
      key: `ops:${err.id}`,
      err,
      tag: 'errored',
      when: fmtUtcShort(err.occurredAt),
      ts: toTs(err.occurredAt),
    }));
    return [...jobEvents, ...opsEvents].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  }, [jobs, liveOpsErrors]);

  const events = useMemo<Event[]>(
    () =>
      sortedBase.map((e) => {
        if (e.kind === 'ops') return e;
        const stale = now !== null && jobIsStale(e.job, now);
        return { ...e, tag: jobTag(e.job, stale), stale };
      }),
    [sortedBase, now],
  );

  const counts = useMemo(() => {
    const c: Record<Tag, number> = { errored: 0, progress: 0, completed: 0 };
    for (const e of events) c[e.tag]++;
    return c;
  }, [events]);

  const [view, setView] = useState<View>('events');
  const [tagFilter, setTagFilter] = useState<Set<Tag>>(() => new Set(TAG_ORDER));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('24h');

  function toggleTag(tag: Tag) {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const visible = useMemo(
    () => events.filter((e) => matchesTag(e, tagFilter) && matchesFilter(e, typeFilter) && matchesRange(e, rangeFilter, now)),
    [events, tagFilter, typeFilter, rangeFilter, now],
  );

  function dismissOne(id: number) {
    setDismissed((prev) => new Set(prev).add(id));
    // Refreshes the server-fetched `opsErrors` prop so a remount (e.g. switching views and back)
    // doesn't resurrect an already-dismissed row from stale data.
    router.refresh();
  }

  return (
    <>
      <JobsLiveRefresh />

      <TabBar bordered className="mb-3">
        <button role="tab" aria-selected={view === 'events'} onClick={() => setView('events')} className={tabCls(view === 'events')}>
          Events ({events.length})
        </button>
        <button role="tab" aria-selected={view === 'history'} onClick={() => setView('history')} className={tabCls(view === 'history')}>
          History
        </button>
      </TabBar>

      {view === 'history' ? (
        <HistoryTable rows={opsErrorHistory} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {TAG_FILTERS.map((f) => (
              <FilterChip key={f.value} value={f.value} label={`${f.label} (${counts[f.value]})`} active={tagFilter.has(f.value)} onClick={toggleTag} />
            ))}
          </div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {TYPE_FILTERS.map((f) => (
              <FilterChip key={f.value} value={f.value} label={f.label} active={typeFilter === f.value} onClick={setTypeFilter} />
            ))}
          </div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {RANGE_FILTERS.map((f) => (
              <FilterChip key={f.value} value={f.value} label={f.label} active={rangeFilter === f.value} onClick={setRangeFilter} />
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState size="lg" message={events.length === 0 ? 'Nothing to show.' : 'Nothing matches this filter.'} />
          ) : (
            <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden max-h-[520px] overflow-y-auto [&>*:first-child]:border-t-0">
              {visible.map((e) =>
                e.kind === 'job' ? (
                  <JobEventRow key={e.key} event={e} now={now} />
                ) : (
                  <OpsEventRow key={e.key} event={e} onJump={onJump} onDismissed={dismissOne} />
                ),
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
