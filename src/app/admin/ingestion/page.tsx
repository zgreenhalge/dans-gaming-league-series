import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TopbarShell } from '@/components/TopbarShell';
import { getDemoIngestJobs, isPlayerAdmin, type DemoIngestJobRow } from '@/lib/queries';
import { IngestJobActions, IngestLiveRefresh } from '@/components/IngestJobActions';
import { fmtUtcShort, matchLabel } from '@/lib/util';

export const metadata = {
  title: 'Demo Ingestion',
  description: 'Admin view of the DatHost/MatchZy demo-ingestion pipeline.',
};

// Don't cache — this is a live operational dashboard.
export const dynamic = 'force-dynamic';

/**
 * Admin ingestion-status page (issue #136, Phase 3b). The dashboard *is* the
 * notification channel: it surfaces every demo-ingest job so nothing fails
 * silently. Minimal + read-only for now — each row links to the match page, where
 * the review block shows parse warnings / quarantine flags and lets an admin
 * confirm the staged result. Post-provision, add columns/actions here without
 * touching the getter (`getDemoIngestJobs` in queries.ts).
 */

// Map each job status to an accent token set + human label. `pending` states that
// still need a human (parsed, quarantined) and `failed` are the ones to watch.
const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  received: { label: 'received', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' },
  queued: { label: 'queued', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-fg)', border: 'var(--color-accent-amber-border)' },
  running: { label: 'running', bg: 'var(--color-accent-blue-bg)', fg: 'var(--color-accent-blue-fg)', border: 'var(--color-accent-blue-border)' },
  parsed: { label: 'parsed · needs review', bg: 'var(--color-accent-blue-bg)', fg: 'var(--color-accent-blue-fg)', border: 'var(--color-accent-blue-border)' },
  quarantined: { label: 'quarantined', bg: 'var(--color-accent-amber-bg)', fg: 'var(--color-accent-amber-strong)', border: 'var(--color-accent-amber-pickborder)' },
  confirmed: { label: 'confirmed', bg: 'var(--color-accent-green-bg)', fg: 'var(--color-accent-green-fg)', border: 'var(--color-accent-green-border)' },
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

function JobRow({ job }: { job: DemoIngestJobRow }) {
  const label = matchLabel({
    matchId: job.matchId,
    seasonName: job.seasonName,
    weekNumber: job.weekNumber,
    matchNumber: job.matchNumber,
  });
  const when = fmtUtcShort(job.updatedAt) ?? '—';
  return (
    <div className="lift-row grid grid-cols-[1fr_auto] gap-2 items-start px-3 py-3 border-b border-[var(--color-border-tertiary)]">
      <div className="min-w-0">
        <Link
          href={`/matches/${job.matchId}`}
          className="font-display text-[15px] font-semibold hover:underline"
        >
          {label}
        </Link>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>#{job.matchId}</span>
          {job.pickedMap && <span>{job.pickedMap}</span>}
          {job.finalScore && <span>score {job.finalScore}</span>}
          {job.isGauntlet && <span className="text-[var(--color-accent-amber-fg)]">gauntlet · manual</span>}
          {job.stage && <span>stage: {job.stage}</span>}
        </div>
        {job.errorMessage && (
          <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)] mt-1 break-words">
            {job.errorMessage}
          </div>
        )}
        {job.quarantineFlags.map((f, i) => (
          <div
            key={`q${i}`}
            className="font-mono text-[11px] text-[var(--color-accent-amber-fg)] mt-1 break-words"
          >
            ⚠ {f}
          </div>
        ))}
        {job.warnings.map((w, i) => (
          <div
            key={`w${i}`}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1 break-words"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <StatusPill status={job.status} />
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{when}</span>
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
        <IngestJobActions matchId={job.matchId} status={job.status} hasPayload={job.hasPayload} />
      </div>
    </div>
  );
}

export default async function IngestionStatusPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');

  const jobs = await getDemoIngestJobs();

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Demo Ingestion' }]} />
      <IngestLiveRefresh />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[28px] font-semibold leading-tight">Demo Ingestion</div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            DatHost/MatchZy pipeline status. <span className="text-[var(--color-accent-blue-fg)]">parsed</span> and{' '}
            <span className="text-[var(--color-accent-amber-fg)]">quarantined</span> jobs need a human — open the match to review and confirm.
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="font-mono text-[13px] text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] rounded px-4 py-8 text-center">
            No demo-ingest jobs yet. Rows appear here once a match POSTs its demo.
          </div>
        ) : (
          <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden">
            {jobs.map((job) => (
              <JobRow key={job.matchId} job={job} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
