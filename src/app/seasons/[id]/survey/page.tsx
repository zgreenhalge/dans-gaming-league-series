import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { checkSeasonFeedbackEligibility } from '@/lib/feedback-access';
import { getSeason, getSurveyForSeason, getPlayerSurveyAnswers, isSurveyOpen } from '@/lib/queries';
import { seasonTitle } from '@/lib/util';
import { FeedbackPageShell, FeedbackPageMessage } from '@/components/FeedbackPageMessage';
import { SurveyForm } from '@/components/SurveyForm';

export const metadata = { title: 'Post-season survey' };

// Per-player answers and the signed-in gate — never cacheable.
export const dynamic = 'force-dynamic';

export default async function SeasonSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const seasonId = Number((await params).id);
  if (!Number.isFinite(seasonId)) notFound();

  const [season, session] = await Promise.all([getSeason(seasonId), getSession()]);
  if (!season || season.is_gauntlet) notFound();
  const shell = { seasonId, seasonTitle: seasonTitle(season.name), crumb: 'Survey', title: `${seasonTitle(season.name)} Survey` };

  const access = await checkSeasonFeedbackEligibility(seasonId, session?.user?.playerId);
  if (!access.ok) {
    const message =
      access.status === 401 ? 'Sign in to take the survey.' : 'Only players who played this season can take its survey.';
    return (
      <FeedbackPageShell {...shell}>
        <FeedbackPageMessage seasonId={seasonId} message={message} />
      </FeedbackPageShell>
    );
  }

  const found = await getSurveyForSeason(seasonId);
  if (!found || !isSurveyOpen(found.survey)) {
    return (
      <FeedbackPageShell {...shell}>
        <FeedbackPageMessage
          seasonId={seasonId}
          message={found ? 'This survey is closed.' : 'There is no survey for this season yet.'}
        />
      </FeedbackPageShell>
    );
  }

  const { responded, answers } = await getPlayerSurveyAnswers(found.survey.id, access.playerId);
  return (
    <FeedbackPageShell {...shell}>
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)] -mt-4 mb-8">
        Your answers are anonymous. You can come back and change them until the survey closes.
      </div>
      <SurveyForm seasonId={seasonId} questions={found.questions} initialAnswers={answers} responded={responded} />
    </FeedbackPageShell>
  );
}
