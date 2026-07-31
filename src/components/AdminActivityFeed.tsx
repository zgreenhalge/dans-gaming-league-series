'use client';

// The unified admin console's Activity feed (issue #262): every background job and every live
// ops_errors row, merged into one status-tiered list — Errored / In Progress / Completed — instead of
// the separate jobs dashboard and ops-errors page this replaces. Each tier renders as a flat,
// newest-first list in a fixed-height scrollable panel, narrowed by a job-type filter rather than
// pre-collapsed into groups — a filter stays useful regardless of how a burst of activity is
// distributed, where a grouping heuristic only helps the shapes it was tuned for.
//
// Job row actions reuse the same per-pipeline islands the old JobsDashboard used
// (`IngestJobActions`, `JobRetryButton`) — only the grouping/tiering here is new, not the mutations.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtUtcShort, tabCls } from '@/lib/util';
import TabBar from './TabBar';
import {
  BACKGROUND_JOB_TYPES,
  JOB_TYPE_LABEL,
  JOB_IN_PROGRESS_STATUSES,
  jobNeedsAttention,
  type BackgroundJobRow,
  type BackgroundJobType,
} from '@/lib/jobs';
import { IngestJobActions } from './IngestJobActions';
import { JobRetryButton, JobsLiveRefresh } from './JobActions';
import { OPERATION_LABELS, type OpsErrorItem } from './OpsErrorList';

type Tier = 'errored' | 'progress' | 'completed';
type TypeFilter = 'all' | BackgroundJobType;
type RangeFilter = 'all' | '30m' | '1h' | '6h' | '12h' | '24h';

interface JobEvent {
  kind: 'job';
  key: string;
  job: BackgroundJobRow;
  when: string | null;
  ts: number | null;
}
interface OpsEvent {
  kind: 'ops';
  key: string;
  err: OpsErrorItem;
  when: string | null;
  ts: number | null;
}
type Event = JobEvent | OpsEvent;

function jobTier(job: BackgroundJobRow): Tier {
  if (jobNeedsAttention(job)) return 'errored';
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

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

function matchesRange(e: Event, range: RangeFilter, now: number): boolean {
  if (range === 'all') return true;
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

function StatusPill({ status }: { status: string }) {
  const failed = status === 'failed';
  const review = status === 'parsed' || status === 'quarantined';
  const progress = JOB_IN_PROGRESS_STATUSES.has(status);
  const cls = failed
    ? 'bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] border-[var(--color-accent-red-border)]'
    : review
      ? 'bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)] border-[var(--color-accent-amber-border)]'
      : progress
        ? 'bg-[var(--color-accent-blue-bg)] text-[var(--color-accent-blue-fg)] border-[var(--color-accent-blue-border)]'
        : 'bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)] border-[var(--color-accent-green-border)]';
  return (
    <span className={`inline-block font-mono text-[10px] px-2 py-[2px] rounded border whitespace-nowrap ${cls}`}>
      {status}
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

/** The per-pipeline action island for a job row — demo gets confirm/dismiss/re-parse, replay/radar retry. */
function JobRowActions({ job }: { job: BackgroundJobRow }) {
  const { subject } = job;
  if (job.jobType === 'demo_ingest' && subject.kind === 'match') {
    return <IngestJobActions matchId={subject.matchId} status={job.status} hasPayload={job.hasPayload} />;
  }
  const inProgress = JOB_IN_PROGRESS_STATUSES.has(job.status);
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
      const res = await fetch(`/api/ops-errors/${id}`, { method: 'DELETE' });
      if (res.ok) onDismissed();
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

function JobEventRow({ event }: { event: JobEvent }) {
  const { job } = event;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-start px-3 py-2.5 border-t border-[var(--color-border-tertiary)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge jobType={job.jobType} />
          <StatusPill status={job.status} />
          <Link href={job.subject.href} className="font-display text-[13px] font-semibold hover:underline truncate">
            {job.subject.label}
          </Link>
        </div>
        {job.errorMessage && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words">{job.errorMessage}</div>
        )}
        {job.quarantineFlags.map((f, i) => (
          <div key={`q${i}`} className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 break-words">
            ⚠ {f}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1 text-right shrink-0">
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums">{event.when ?? '—'}</span>
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
          <JobRowActions job={job} />
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
  return (
    <div className="px-3 py-2.5 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
            <DismissOpsError id={err.id} onDismissed={() => onDismissed(err.id)} />
          </div>
        </div>
      </div>
    </div>
  );
}

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...BACKGROUND_JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABEL[t] })),
];

const RANGE_FILTERS: { value: RangeFilter; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '12h', label: '12h' },
  { value: '6h', label: '6h' },
  { value: '1h', label: '1h' },
  { value: '30m', label: '30m' },
  { value: 'all', label: 'All time' },
];

export function AdminActivityFeed({
  jobs,
  opsErrors,
  onJump,
}: {
  jobs: BackgroundJobRow[];
  opsErrors: OpsErrorItem[];
  onJump: (type: 'match' | 'player' | 'season', query: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const liveOpsErrors = useMemo(() => opsErrors.filter((e) => !dismissed.has(e.id)), [opsErrors, dismissed]);

  const { errored, progress, completed } = useMemo(() => {
    const jobEvents: JobEvent[] = jobs.map((job) => ({
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
      when: fmtUtcShort(err.occurredAt),
      ts: toTs(err.occurredAt),
    }));

    const errored: Event[] = [
      ...jobEvents.filter((e) => jobTier(e.job) === 'errored'),
      ...opsEvents,
    ].sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
    const progress: Event[] = jobEvents.filter((e) => jobTier(e.job) === 'progress');
    const completed: Event[] = jobEvents.filter((e) => jobTier(e.job) === 'completed');

    return { errored, progress, completed };
  }, [jobs, liveOpsErrors]);

  const [tab, setTab] = useState<Tier>(() => {
    if (errored.length > 0) return 'errored';
    if (progress.length > 0) return 'progress';
    return 'completed';
  });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('24h');

  // `Date.now()` can't be read during render (impure) — track it in state, refreshed periodically, so
  // the range filter (30m/1h/…) has a "now" to compare against without one.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  const byTier: Record<Tier, Event[]> = useMemo(
    () => ({ errored, progress, completed }),
    [errored, progress, completed],
  );
  const visible = useMemo(
    () => byTier[tab].filter((e) => matchesFilter(e, typeFilter) && matchesRange(e, rangeFilter, now)),
    [byTier, tab, typeFilter, rangeFilter, now],
  );

  function dismissOne(id: number) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  const EMPTY_MESSAGE: Record<Tier, string> = {
    errored: 'Nothing needs attention.',
    progress: 'Nothing running right now.',
    completed: 'Nothing completed yet.',
  };

  return (
    <>
      <JobsLiveRefresh />

      <TabBar bordered className="mb-3">
        <button onClick={() => setTab('errored')} className={tabCls(tab === 'errored')}>
          Errored ({errored.length})
        </button>
        <button onClick={() => setTab('progress')} className={tabCls(tab === 'progress')}>
          In Progress ({progress.length})
        </button>
        <button onClick={() => setTab('completed')} className={tabCls(tab === 'completed')}>
          Completed ({completed.length})
        </button>
      </TabBar>

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
        <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
          {byTier[tab].length === 0 ? EMPTY_MESSAGE[tab] : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden max-h-[520px] overflow-y-auto [&>*:first-child]:border-t-0">
          {visible.map((e) =>
            e.kind === 'job' ? (
              <JobEventRow key={e.key} event={e} />
            ) : (
              <OpsEventRow key={e.key} event={e} onJump={onJump} onDismissed={dismissOne} />
            ),
          )}
        </div>
      )}
    </>
  );
}
