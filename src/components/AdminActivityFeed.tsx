'use client';

// The unified admin console's Activity feed (issue #262): every background job and every live
// ops_errors row, merged into one status-tiered list — Errored / In Progress / Completed — instead of
// the separate jobs dashboard and ops-errors page this replaces. Errored never clusters (a failure
// should never be one line buried in "38 more…"); Completed clusters consecutive same-type/same-status
// runs, since that's the only tier bulk operations (a season-wide demo reparse) actually flood.
//
// Job row actions reuse the same per-pipeline islands the old JobsDashboard used
// (`IngestJobActions`, `JobRetryButton`) — only the grouping/tiering here is new, not the mutations.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { fmtUtcShort, tabCls } from '@/lib/util';
import TabBar from './TabBar';
import {
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

interface JobEvent {
  kind: 'job';
  key: string;
  job: BackgroundJobRow;
  when: string | null;
}
interface OpsEvent {
  kind: 'ops';
  key: string;
  err: OpsErrorItem;
  when: string | null;
}
type Event = JobEvent | OpsEvent;

function jobTier(job: BackgroundJobRow): Tier {
  if (jobNeedsAttention(job)) return 'errored';
  if (JOB_IN_PROGRESS_STATUSES.has(job.status)) return 'progress';
  return 'completed';
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
        <JobRowActions job={job} />
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

interface CompletedCluster {
  key: string;
  jobType: BackgroundJobType;
  status: string;
  items: JobEvent[];
}

const CLUSTER_MIN = 5;

/** Collapse consecutive (already time-sorted) same-type/same-status completions into one rollup —
 * this is what makes a 40-match bulk reparse read as one line instead of 40. Real bursts cluster
 * naturally since they finish close together and land adjacent once sorted; nothing here depends on
 * a persisted "batch" concept. */
function clusterCompleted(events: JobEvent[]): (JobEvent | CompletedCluster)[] {
  const out: (JobEvent | CompletedCluster)[] = [];
  let i = 0;
  while (i < events.length) {
    const cur = events[i];
    let j = i + 1;
    while (j < events.length && events[j].job.jobType === cur.job.jobType && events[j].job.status === cur.job.status) {
      j++;
    }
    const run = events.slice(i, j);
    if (run.length >= CLUSTER_MIN) {
      out.push({ key: `cluster:${cur.key}`, jobType: cur.job.jobType, status: cur.job.status, items: run });
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}

function ClusterRow({ cluster }: { cluster: CompletedCluster }) {
  return (
    <details className="border-t border-[var(--color-border-tertiary)]">
      <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">▶</span>
        <TypeBadge jobType={cluster.jobType} />
        <StatusPill status={cluster.status} />
        <span className="font-mono text-[12.5px]">{cluster.items.length} jobs</span>
      </summary>
      <ul className="pb-2">
        {cluster.items.map((e) => (
          <li key={e.key} className="px-3 py-1 flex items-center justify-between gap-3 pl-9">
            <Link href={e.job.subject.href} className="font-mono text-[11.5px] hover:underline truncate">
              {e.job.subject.label}
            </Link>
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)] tabular-nums shrink-0">
              {e.when ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

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
    }));
    const opsEvents: OpsEvent[] = liveOpsErrors.map((err) => ({
      kind: 'ops',
      key: `ops:${err.id}`,
      err,
      when: fmtUtcShort(err.occurredAt),
    }));

    const errored: Event[] = [
      ...jobEvents.filter((e) => jobTier(e.job) === 'errored'),
      ...opsEvents,
    ].sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
    const progress = jobEvents.filter((e) => jobTier(e.job) === 'progress');
    const completed = jobEvents.filter((e) => jobTier(e.job) === 'completed');

    return { errored, progress, completed };
  }, [jobs, liveOpsErrors]);

  const completedClustered = useMemo(() => clusterCompleted(completed), [completed]);

  const [tab, setTab] = useState<Tier>(() => {
    if (errored.length > 0) return 'errored';
    if (progress.length > 0) return 'progress';
    return 'completed';
  });

  function dismissOne(id: number) {
    setDismissed((prev) => new Set(prev).add(id));
  }

  return (
    <>
      <JobsLiveRefresh />

      <TabBar bordered className="mb-4">
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

      {tab === 'errored' &&
        (errored.length === 0 ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
            Nothing needs attention.
          </div>
        ) : (
          <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden [&>*:first-child]:border-t-0">
            {errored.map((e) =>
              e.kind === 'job' ? (
                <JobEventRow key={e.key} event={e} />
              ) : (
                <OpsEventRow key={e.key} event={e} onJump={onJump} onDismissed={dismissOne} />
              ),
            )}
          </div>
        ))}

      {tab === 'progress' &&
        (progress.length === 0 ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
            Nothing running right now.
          </div>
        ) : (
          <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden [&>*:first-child]:border-t-0">
            {progress.map((e) => (
              <JobEventRow key={e.key} event={e} />
            ))}
          </div>
        ))}

      {tab === 'completed' &&
        (completedClustered.length === 0 ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
            Nothing completed yet.
          </div>
        ) : (
          <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden max-h-[480px] overflow-y-auto [&>*:first-child]:border-t-0">
            {completedClustered.map((item) =>
              'items' in item ? <ClusterRow key={item.key} cluster={item} /> : <JobEventRow key={item.key} event={item} />,
            )}
          </div>
        ))}
    </>
  );
}
