import { STAGE_STATUS_LABEL, type StageStatus } from '@/lib/stage-views';

/** Status pill for a week, round or group — same visual family as the season's Live tag. */
export function StageStatusTag({ status }: { status: StageStatus }) {
  if (status === 'in-progress') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)] shrink-0">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
        {STAGE_STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] shrink-0">
      {STAGE_STATUS_LABEL[status]}
    </span>
  );
}
