// Server-side builders for the season page's Survey and Superlatives tabs: each turns one viewer's
// view (`getSeasonSurveyView()` / `getSeasonSuperlativesView()`) into a ready-rendered tab body for
// the client tab components. The two are independent — either can exist without the other.

import Link from 'next/link';
import type { SurveyTabView, SuperlativesTabView } from '@/lib/queries';
import type { FeedbackTab } from './TopTabBar';
import { SurveyForm } from './SurveyForm';
import { SuperlativesBallot } from './SuperlativesBallot';
import { SuperlativeResultsPanel } from './SuperlativeResults';

/** Admin-only link from a tab to its admin page (`/admin/seasons/<kind>/<id>`). */
function ManageLink({ kind, seasonId, isAdmin }: { kind: 'survey' | 'superlatives'; seasonId: number; isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <Link
      href={`/admin/seasons/${kind}/${seasonId}`}
      className="tracked text-[10px] font-semibold inline-block mb-4 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
    >
      Manage →
    </Link>
  );
}

const NOTE_CLS = 'font-mono text-[12px] text-[var(--color-text-secondary)] mb-8';

export function buildSurveyTab(seasonId: number, view: SurveyTabView | null, isAdmin: boolean): FeedbackTab[] {
  if (!view) return [];
  return [
    {
      key: 'survey',
      label: 'Survey',
      content: (
        <div className="max-w-[720px]">
          <ManageLink kind="survey" seasonId={seasonId} isAdmin={isAdmin} />
          <div className={NOTE_CLS}>Your answers are anonymous. You can come back and change them until the survey closes.</div>
          <SurveyForm seasonId={seasonId} questions={view.questions} initialAnswers={view.answers} responded={view.responded} />
        </div>
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
          <div className="max-w-[720px]">
            <ManageLink kind="superlatives" seasonId={seasonId} isAdmin={isAdmin} />
            <div className={NOTE_CLS}>
              Pick anyone who played this season, yourself included. You can change your votes until voting closes.
            </div>
            <SuperlativesBallot seasonId={seasonId} superlatives={view.superlatives} nominees={view.nominees} initialVotes={view.votes} />
          </div>
        ) : (
          <>
            <ManageLink kind="superlatives" seasonId={seasonId} isAdmin={isAdmin} />
            <SuperlativeResultsPanel results={view.results} />
          </>
        ),
    },
  ];
}
