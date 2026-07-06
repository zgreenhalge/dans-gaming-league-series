'use client';

// Interactive admin background-jobs dashboard (#145). Groups jobs by subject (one card per match with
// demo/replay lanes, one per map with a radar lane) and offers two tabs — Needs Attention (default
// when non-empty; counts jobs needing a human) and All Jobs — plus per-type filters (demo/replay/
// radar). Server-rendered data comes in as pre-grouped `JobGroup[]`; all tab/type filtering + counts
// are derived here so the surface stays live and interactive. Actions reuse the existing per-pipeline
// islands (`IngestJobActions`, `JobRetryButton`).

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { fmtUtcShort, tabCls } from '@/lib/util';
import {
  JOB_TYPE_LABEL,
  type BackgroundJobRow,
  type BackgroundJobType,
  type JobGroup,
  type JobLane,
} from '@/lib/jobs';
import { IngestJobActions } from './IngestJobActions';
import { JobRetryButton, JobsLiveRefresh } from './JobActions';

// Statuses with work still in flight — retry is a no-op, so lanes show "working…" instead.
const IN_PROGRESS: ReadonlySet<string> = new Set(['received', 'queued', 'running']);

// Status → accent tokens + human label. Review states (parsed/quarantined) and failures are the ones
// to watch; confirmed/succeeded are terminal.
const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  received: { label: 'received', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' },
  queued: { label: 'queued', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' },
  running: { label: 'running', bg: 'var(--color-accent-blue-bg)', fg: 'var(--color-accent-blue-fg)', border: 'var(--color-accent-blue-border)' },
  parsed: { label: 'parsed · needs review', bg: 'var(--color-accent-blue-bg)', fg: 'var(--color-accent-blue-fg)', border: 'var(--color-accent-blue-border)' },
  quarantined: { label: 'quarantined', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-strong)', border: 'var(--color-accent-amber-pickborder)' },
  confirmed: { label: 'confirmed', bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' },
  succeeded: { label: 'succeeded', bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' },
  ready: { label: 'ready', bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' },
  dismissed: { label: 'dismissed', bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border-secondary)' },
  failed: { label: 'failed', bg: 'var(--color-accent-red-bg)', fg: 'var(--color-accent-red-fg)', border: 'var(--color-accent-red-border)' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {
    label: status,
    bg: 'transparent',
    fg: 'var(--color-text-secondary)',
    border: 'var(--color-border-secondary)',
  };
  return (
    <span
      className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg, borderColor: s.border }}
    >
      {s.label}
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

/** The per-pipeline action island for a lane — demo gets confirm/dismiss/re-parse, replay/radar retry. */
function LaneActions({ job }: { job: BackgroundJobRow }) {
  const { subject } = job;
  if (job.jobType === 'demo_ingest' && subject.kind === 'match') {
    return <IngestJobActions matchId={subject.matchId} status={job.status} hasPayload={job.hasPayload} />;
  }
  const inProgress = IN_PROGRESS.has(job.status);
  if (job.jobType === 'replay_extract' && subject.kind === 'match') {
    return <JobRetryButton dispatchUrl={`/api/matches/${subject.matchId}/replay/dispatch`} inProgress={inProgress} />;
  }
  if (job.jobType === 'radar_build' && subject.kind === 'map') {
    return <JobRetryButton dispatchUrl={`/api/maps/${subject.slug}/radar/dispatch`} inProgress={inProgress} />;
  }
  return null;
}

function LaneRow({ lane }: { lane: JobLane }) {
  const { job } = lane;
  const when = fmtUtcShort(job.updatedAt) ?? '—';
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 items-start px-3 py-2.5 border-t border-[var(--color-border-tertiary)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge jobType={job.jobType} />
          <StatusPill status={job.status} />
          {job.stage && (
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">stage: {job.stage}</span>
          )}
        </div>
        {job.errorMessage && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words">{job.errorMessage}</div>
        )}
        {job.quarantineFlags.map((f, i) => (
          <div key={`q${i}`} className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 break-words">
            ⚠ {f}
          </div>
        ))}
        {job.warnings.map((w, i) => (
          <div key={`w${i}`} className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1 break-words">
            {w}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{when}</span>
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
          <LaneActions job={job} />
        </div>
      </div>
    </div>
  );
}

/** One subject card — a match (demo/replay lanes) or a map (radar lane). `lanes` is already filtered. */
function SubjectCard({ subject, lanes }: { subject: JobGroup['subject']; lanes: JobLane[] }) {
  return (
    <div className="lift-card border border-[var(--color-border-tertiary)] rounded overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <Link href={subject.href} className="font-display text-[15px] font-semibold hover:underline truncate">
          {subject.label}
        </Link>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] flex flex-wrap justify-end gap-x-3 gap-y-1 shrink-0">
          {subject.kind === 'match' ? (
            <>
              <span>#{subject.matchId}</span>
              {subject.pickedMap && <span>{subject.pickedMap}</span>}
              {subject.finalScore && <span>score {subject.finalScore}</span>}
              {subject.isGauntlet && <span className="text-[var(--color-accent-amber-fg)]">gauntlet</span>}
            </>
          ) : (
            <span>map #{subject.mapId}</span>
          )}
        </div>
      </div>
      {lanes.map((lane) => (
        <LaneRow key={lane.job.jobType} lane={lane} />
      ))}
    </div>
  );
}

// ── About tab: a formatted reference for each pipeline (purpose · lifecycle · admin actions) ──

type StageTone = 'neutral' | 'review' | 'done';

interface PipelineDoc {
  jobType: BackgroundJobType;
  name: string;
  purpose: string;
  /** Top-level status lifecycle, shown as a chip flow. */
  lifecycle: { label: string; tone: StageTone }[];
  /** Sub-steps the Action runs while `running` (shown as a muted note). */
  running?: string[];
  admin: ReactNode;
}

const PIPELINES: PipelineDoc[] = [
  {
    jobType: 'demo_ingest',
    name: 'demo ingest',
    purpose: "Parses a match's demo into its final score and player stats, then stages the result for review.",
    lifecycle: [
      { label: 'received', tone: 'neutral' },
      { label: 'queued', tone: 'neutral' },
      { label: 'running', tone: 'neutral' },
      { label: 'parsed / quarantined', tone: 'review' },
      { label: 'confirmed', tone: 'done' },
    ],
    admin: (
      <>
        <b>Confirm</b> the staged score, <b>Re-parse</b> the demo, or <b>Dismiss</b> the result.
      </>
    ),
  },
  {
    jobType: 'replay_extract',
    name: 'replay extract',
    purpose: 'Builds the in-browser 2D replay and heatmap from the demo already in storage.',
    lifecycle: [
      { label: 'queued', tone: 'neutral' },
      { label: 'running', tone: 'neutral' },
      { label: 'ready', tone: 'done' },
    ],
    running: ['download', 'parse-ticks', 'upload', 'heatmap'],
    admin: <><b>Retry</b> a failed extract.</>,
  },
  {
    jobType: 'radar_build',
    name: 'radar build',
    purpose: 'Extracts a top-down radar image and calibration from the workshop map.',
    lifecycle: [
      { label: 'queued', tone: 'neutral' },
      { label: 'running', tone: 'neutral' },
      { label: 'succeeded', tone: 'done' },
    ],
    running: ['steamcmd', 'decode-vtex', 'calibrate', 'upload'],
    admin: <><b>Retry</b> a failed build.</>,
  },
];

const STAGE_TONE_STYLE: Record<StageTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'transparent', fg: 'var(--color-text-secondary)', border: 'var(--color-border-secondary)' },
  review: { bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' },
  done: { bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' },
};

function StageFlow({ stages }: { stages: { label: string; tone: StageTone }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {stages.map((s, i) => {
        const style = STAGE_TONE_STYLE[s.tone];
        return (
          <Fragment key={s.label}>
            {i > 0 && <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">→</span>}
            <span
              className="inline-block font-mono text-[11px] px-2 py-[2px] rounded border whitespace-nowrap"
              style={{ backgroundColor: style.bg, color: style.fg, borderColor: style.border }}
            >
              {s.label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">
      {children}
    </div>
  );
}

function AboutPipelines() {
  return (
    <div className="flex flex-col gap-3">
      {PIPELINES.map((p) => (
        <div key={p.jobType} className="border border-[var(--color-border-tertiary)] rounded px-4 py-4">
          <div className="flex items-center gap-2 mb-2">
            <TypeBadge jobType={p.jobType} />
            <span className="font-display text-[17px] font-semibold">{p.name}</span>
          </div>
          <p className="font-mono text-[12px] text-[var(--color-text-secondary)] leading-relaxed">{p.purpose}</p>

          <div className="mt-4">
            <SectionLabel>Stages</SectionLabel>
            <StageFlow stages={p.lifecycle} />
            {p.running && (
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5">
                while running: {p.running.join(' → ')}
              </div>
            )}
          </div>

          <div className="mt-4">
            <SectionLabel>Admin</SectionLabel>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">{p.admin}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

type Tab = 'attention' | 'all' | 'about';
type SubjectKind = 'match' | 'map';

const SUBJECT_KINDS: readonly SubjectKind[] = ['match', 'map'];
const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = { match: 'matches', map: 'maps' };

export function JobsDashboard({ groups }: { groups: JobGroup[] }) {
  const [activeKinds, setActiveKinds] = useState<Set<SubjectKind>>(() => new Set(SUBJECT_KINDS));
  // Default to Needs Attention when anything needs a human.
  const [tab, setTab] = useState<Tab>(() =>
    groups.some((g) => g.lanes.some((l) => l.needsAttention)) ? 'attention' : 'all',
  );

  // Attention count reflects the active matches/maps filter — it's what the tab currently shows.
  const attentionCount = useMemo(
    () =>
      groups.reduce(
        (n, g) =>
          n + (activeKinds.has(g.subject.kind) ? g.lanes.filter((l) => l.needsAttention).length : 0),
        0,
      ),
    [groups, activeKinds],
  );

  // Apply both filters: keep groups of an active subject kind, and (on the attention tab) only their
  // lanes needing attention; drop groups left with no visible lanes.
  const visibleGroups = useMemo(() => {
    return groups
      .filter((g) => activeKinds.has(g.subject.kind))
      .map((g) => ({
        ...g,
        lanes: g.lanes.filter((l) => tab === 'all' || l.needsAttention),
      }))
      .filter((g) => g.lanes.length > 0);
  }, [groups, activeKinds, tab]);

  const matchGroups = visibleGroups.filter((g) => g.subject.kind === 'match');
  const mapGroups = visibleGroups.filter((g) => g.subject.kind === 'map');

  function toggleKind(k: SubjectKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <>
      <JobsLiveRefresh />

      {/* Tabs — mirrors the /players Upcoming pattern: a count baked into the label. */}
      <div className="flex items-center gap-0 border-b border-[var(--color-border-primary)] mb-4">
        <button onClick={() => setTab('attention')} className={tabCls(tab === 'attention')}>
          Needs Attention ({attentionCount})
        </button>
        <button onClick={() => setTab('all')} className={tabCls(tab === 'all')}>
          All Jobs
        </button>
        <button onClick={() => setTab('about')} className={tabCls(tab === 'about')}>
          About
        </button>
      </div>

      {tab === 'about' ? (
        <AboutPipelines />
      ) : (
        <JobsList
          matchGroups={matchGroups}
          mapGroups={mapGroups}
          hasVisible={visibleGroups.length > 0}
          isAttention={tab === 'attention'}
          activeKinds={activeKinds}
          onToggleKind={toggleKind}
        />
      )}
    </>
  );
}

/** The filter chips + grouped job sections — everything except the About tab. */
function JobsList({
  matchGroups,
  mapGroups,
  hasVisible,
  isAttention,
  activeKinds,
  onToggleKind,
}: {
  matchGroups: JobGroup[];
  mapGroups: JobGroup[];
  hasVisible: boolean;
  isAttention: boolean;
  activeKinds: Set<SubjectKind>;
  onToggleKind: (k: SubjectKind) => void;
}) {
  return (
    <>
      {/* Matches / maps filter chips. */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {SUBJECT_KINDS.map((k) => {
          const active = activeKinds.has(k);
          return (
            <button
              key={k}
              onClick={() => onToggleKind(k)}
              aria-pressed={active}
              className={`font-mono text-[11px] px-2.5 py-1 rounded border transition-colors ${
                active
                  ? 'border-[var(--color-accent)] text-[var(--color-text-primary)] bg-[var(--color-accent-blue-bg)]'
                  : 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {SUBJECT_KIND_LABEL[k]}
            </button>
          );
        })}
      </div>

      {!hasVisible ? (
        <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
          {isAttention
            ? 'All clear — no jobs need attention.'
            : 'No background jobs match the current filters.'}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {matchGroups.length > 0 && (
            <section>
              <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                Matches
              </div>
              <div className="flex flex-col gap-3">
                {matchGroups.map((g) => (
                  <SubjectCard key={g.key} subject={g.subject} lanes={g.lanes} />
                ))}
              </div>
            </section>
          )}
          {mapGroups.length > 0 && (
            <section>
              <div className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                Maps
              </div>
              <div className="flex flex-col gap-3">
                {mapGroups.map((g) => (
                  <SubjectCard key={g.key} subject={g.subject} lanes={g.lanes} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
