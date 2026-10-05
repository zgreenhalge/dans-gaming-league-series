import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { checkSeasonFeedbackEligibility } from '@/lib/feedback-access';
import { getSeason, getSuperlativePoll, getPlayerSuperlativeVotes } from '@/lib/queries';
import { seasonTitle } from '@/lib/util';
import { FeedbackPageShell, FeedbackPageMessage } from '@/components/FeedbackPageMessage';
import { SuperlativesBallot } from '@/components/SuperlativesBallot';

export const metadata = { title: 'Season superlatives' };

// Per-player ballot and the signed-in gate — never cacheable.
export const dynamic = 'force-dynamic';

export default async function SeasonSuperlativesPage({ params }: { params: Promise<{ id: string }> }) {
  const seasonId = Number((await params).id);
  if (!Number.isFinite(seasonId)) notFound();

  const [season, session] = await Promise.all([getSeason(seasonId), getSession()]);
  if (!season || season.is_gauntlet) notFound();
  const shell = { seasonId, seasonTitle: seasonTitle(season.name), crumb: 'Superlatives', title: `${seasonTitle(season.name)} Superlatives` };

  const access = await checkSeasonFeedbackEligibility(seasonId, session?.user?.playerId);
  if (!access.ok) {
    const message =
      access.status === 401 ? 'Sign in to vote.' : 'Only players who played this season can vote on its superlatives.';
    return (
      <FeedbackPageShell {...shell}>
        <FeedbackPageMessage seasonId={seasonId} message={message} />
      </FeedbackPageShell>
    );
  }

  const poll = await getSuperlativePoll(seasonId);
  if (!poll?.isOpen || poll.superlatives.length === 0) {
    return (
      <FeedbackPageShell {...shell}>
        <FeedbackPageMessage
          seasonId={seasonId}
          message={poll && poll.superlatives.length > 0 ? 'Voting is closed.' : 'Voting is not open for this season.'}
        />
      </FeedbackPageShell>
    );
  }

  const votes = await getPlayerSuperlativeVotes(seasonId, access.playerId);
  return (
    <FeedbackPageShell {...shell}>
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)] -mt-4 mb-8">
        Pick anyone who played this season, yourself included. You can change your votes until voting closes.
      </div>
      <SuperlativesBallot
        seasonId={seasonId}
        superlatives={poll.superlatives}
        nominees={access.eligible.map((p) => ({ id: p.player_id, name: p.player_name }))}
        initialVotes={votes}
      />
    </FeedbackPageShell>
  );
}
