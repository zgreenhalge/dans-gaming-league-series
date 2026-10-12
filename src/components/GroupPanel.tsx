import Link from 'next/link';
import EmptyState from './EmptyState';
import { GameMatchCard, PendingPodRows } from './GauntletRoundsList';
import { GroupScorecard } from './StageScorecard';
import { StageStatusTag } from './StageStatusTag';
import { groupHref } from '@/lib/crumbs';
import { computeAdvanceOrdinals, podsById as buildPodsById } from '@/lib/gauntlet-draft';
import { groupCaption, type GroupView } from '@/lib/stage-views';
import type { BracketPod } from '@/lib/queries';

/**
 * One gauntlet group: header (name, status, link to its page), scorecard, then its games — or the
 * "not yet scheduled" lineup while the pod is still waiting on its bracket. Used for every group on
 * a round page and for the single group on a group page (`standalone`, no self-link).
 */
export function GroupPanel({
  group,
  hubSeasonId,
  bracketShape,
  seedNames,
  currentPlayerId,
  standalone = false,
}: {
  group: GroupView;
  hubSeasonId: number;
  bracketShape: BracketPod[];
  seedNames?: Map<number, string>;
  currentPlayerId: number | null;
  standalone?: boolean;
}) {
  const finished = group.status === 'complete';
  const title = group.label ?? 'Games';
  return (
    <section className="mb-6 last:mb-0">
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <h2 className="font-display text-[20px] font-semibold leading-tight">
          {standalone || !group.pod ? (
            title
          ) : (
            <Link href={groupHref(hubSeasonId, group.pod.id)} className="hover:text-[var(--color-site-accent)] transition-colors">
              {title}
            </Link>
          )}
        </h2>
        <StageStatusTag status={group.status} />
      </div>
      {group.scorecard.length > 0 && (
        <div className="mb-3">
          <GroupScorecard
            rows={group.scorecard}
            isFinal={group.isFinal}
            finished={finished}
            caption={groupCaption(group)}
            currentPlayerId={currentPlayerId}
          />
        </div>
      )}
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
        {group.matches.length > 0 ? (
          group.matches.map((m, i) => (
            <GameMatchCard key={m.id} match={m} gameNumber={group.pod ? i + 1 : m.match_number} currentPlayerId={currentPlayerId} />
          ))
        ) : group.pod ? (
          <PendingPodRows
            pod={group.pod}
            podsById={buildPodsById(bracketShape)}
            advanceOrdinals={computeAdvanceOrdinals(bracketShape)}
            seedNames={seedNames}
            currentPlayerId={currentPlayerId}
          />
        ) : (
          <EmptyState message="No games yet." />
        )}
      </div>
    </section>
  );
}
