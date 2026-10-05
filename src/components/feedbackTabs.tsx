// Server-side builder for the season page's Survey and Superlatives tabs: turns one viewer's
// `SeasonFeedbackView` into the ready-rendered tab bodies the client tab components display.
// A tab only exists when there is something for this viewer to do or see (see
// `getSeasonFeedbackView()` for the rules).

import type { SeasonFeedbackView } from '@/lib/queries';
import type { FeedbackTab } from './TopTabBar';
import { SurveyForm } from './SurveyForm';
import { SuperlativesBallot } from './SuperlativesBallot';
import { SuperlativeResultsPanel } from './SuperlativeResults';

const NOTE_CLS = 'font-mono text-[12px] text-[var(--color-text-secondary)] mb-8';

export function buildFeedbackTabs(seasonId: number, view: SeasonFeedbackView): FeedbackTab[] {
  const tabs: FeedbackTab[] = [];

  if (view.survey) {
    tabs.push({
      key: 'survey',
      label: 'Survey',
      content: (
        <div className="max-w-[720px]">
          <div className={NOTE_CLS}>Your answers are anonymous. You can come back and change them until the survey closes.</div>
          <SurveyForm
            seasonId={seasonId}
            questions={view.survey.questions}
            initialAnswers={view.survey.answers}
            responded={view.survey.responded}
          />
        </div>
      ),
    });
  }

  if (view.superlatives) {
    tabs.push({
      key: 'superlatives',
      label: 'Superlatives',
      content:
        view.superlatives.mode === 'ballot' ? (
          <div className="max-w-[720px]">
            <div className={NOTE_CLS}>
              Pick anyone who played this season, yourself included. You can change your votes until voting closes.
            </div>
            <SuperlativesBallot
              seasonId={seasonId}
              superlatives={view.superlatives.superlatives}
              nominees={view.superlatives.nominees}
              initialVotes={view.superlatives.votes}
            />
          </div>
        ) : (
          <SuperlativeResultsPanel results={view.superlatives.results} />
        ),
    });
  }

  return tabs;
}
