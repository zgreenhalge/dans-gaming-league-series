import Link from 'next/link';
import EmptyState from './EmptyState';
import { CollapsibleSection } from './CollapsibleSection';
import { GameMatchCard, PendingPodRows } from './GauntletRoundsList';
import { GroupScorecard } from './StageScorecard';
import { groupHref } from '@/lib/crumbs';
import { computeAdvanceOrdinals, podsById as buildPodsById } from '@/lib/gauntlet-draft';
import type { GroupView } from '@/lib/stage-views';
import type { BracketPod } from '@/lib/queries';

/**
 * One gauntlet group: its scorecard, then its games — or the "not yet scheduled" lineup while the pod
 * is still waiting on its bracket. On a round with several groups each is a collapsible section
 * (`collapsible`, the season schedule's week-row look, its title linking to the group's page); a lone group, or
 * the group page itself, shows a plain heading over the same content.
 */
export function GroupPanel({
  group,
  hubSeasonId,
  bracketShape,
  seedNames,
  currentPlayerId,
  collapsible = false,
  standalone = false,
}: {
  group: GroupView;
  hubSeasonId: number;
  bracketShape: BracketPod[];
  seedNames?: Map<number, string>;
  currentPlayerId: number | null;
  collapsible?: boolean;
  /** The group's own page: its heading doesn't link to itself. */
  standalone?: boolean;
}) {
  const finished = group.status === 'complete';
  const title = group.label ?? 'Games';
  const href = group.pod ? groupHref(hubSeasonId, group.pod.id) : undefined;

  const games =
    group.matches.length > 0 ? (
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
    );

  if (collapsible) {
    return (
      <CollapsibleSection
        title={title}
        detail={group.isFinal ? undefined : group.advanceRule === 'wildcard' ? 'Wildcard' : group.advanceRule ? 'Elimination' : undefined}
        href={href}
      >
        {group.scorecard.length > 0 && (
          <div className="border-b border-[var(--color-border-primary)]">
            <GroupScorecard rows={group.scorecard} isFinal={group.isFinal} finished={finished} bare currentPlayerId={currentPlayerId} />
          </div>
        )}
        {games}
      </CollapsibleSection>
    );
  }

  return (
    <section className="mb-6 last:mb-0">
      <h2 className="font-display text-[20px] font-semibold leading-tight mb-2">
        {standalone || !href ? (
          title
        ) : (
          <Link href={href} className="hover:text-[var(--color-site-accent)] transition-colors">
            {title}
          </Link>
        )}
      </h2>
      {group.scorecard.length > 0 && (
        <div className="mb-3">
          <GroupScorecard rows={group.scorecard} isFinal={group.isFinal} finished={finished} currentPlayerId={currentPlayerId} />
        </div>
      )}
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">{games}</div>
    </section>
  );
}
