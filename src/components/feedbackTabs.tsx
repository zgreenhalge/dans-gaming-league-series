// Server-side builders for the season page's Survey and Superlatives tabs: each turns one viewer's
// view (`getSeasonSurveyView()` / `getSeasonSuperlativesView()`) into a ready-rendered tab body for
// the client tab components. The two are independent — either can exist without the other.

import Link from 'next/link';
import type { SurveyTabView, SuperlativesTabView } from '@/lib/queries';
import type { FeedbackTab } from './TopTabBar';
import { SurveyForm } from './SurveyForm';
import { SuperlativesBallot } from './SuperlativesBallot';
import { SuperlativeResultsPanel } from './SuperlativeResults';
import { FeedbackFormFrame } from './FeedbackFormFrame';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';

/** Admin-only link from a tab to its admin page (`/admin/seasons/<kind>/<id>`). */
function manageLink(kind: 'survey' | 'superlatives', seasonId: number, isAdmin: boolean) {
  if (!isAdmin) return null;
  return (
    <Link href={`/admin/seasons/${kind}/${seasonId}`} className={ADMIN_SMALL_BUTTON_CLS}>
      Manage →
    </Link>
  );
}

export function buildSurveyTab(seasonId: number, view: SurveyTabView | null, isAdmin: boolean): FeedbackTab[] {
  if (!view) return [];
  return [
    {
      key: 'survey',
      label: 'Survey',
      content: (
        <SurveyForm
          seasonId={seasonId}
          questions={view.questions}
          initialAnswers={view.answers}
          responded={view.responded}
          manage={manageLink('survey', seasonId, isAdmin)}
          note="Your answers are anonymous. You can come back and change them until the survey closes."
        />
      ),
    },
  ];
}

export function buildSuperlativesTab(seasonId: number, view: SuperlativesTabView | null, isAdmin: boolean): FeedbackTab[] {
  if (!view) return [];
  return [
    {
      key: 'superlatives',
      label: 'Superlatives',
      content:
        view.mode === 'ballot' ? (
          <SuperlativesBallot
            seasonId={seasonId}
            superlatives={view.superlatives}
            nominees={view.nominees}
            initialVotes={view.votes}
            manage={manageLink('superlatives', seasonId, isAdmin)}
            note="Pick anyone who played this season, yourself included. You can change your votes until voting closes."
          />
        ) : (
          <FeedbackFormFrame manage={manageLink('superlatives', seasonId, isAdmin)} wide>
            <SuperlativeResultsPanel results={view.results} />
          </FeedbackFormFrame>
        ),
    },
  ];
}
