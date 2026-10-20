import { STAGE_STATUS_LABEL, type StageStatus } from '@/lib/stage-views';
import { StatusPill } from './StatusPill';

/** Status pill for a week, round or group — same visual family as the season's Live tag. */
export function StageStatusTag({ status }: { status: StageStatus }) {
  return (
    <StatusPill variant={status === 'in-progress' ? 'live' : 'neutral'}>{STAGE_STATUS_LABEL[status]}</StatusPill>
  );
}
