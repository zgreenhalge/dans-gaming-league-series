// The season page's top-level tab row (Regular Season / Gauntlet / Survey / Superlatives). Shared by
// `CombinedSeasonTabView` and `SeasonFeedbackTabs` so both render the same bar.

import type { ReactNode } from 'react';
import { tabCls } from '@/lib/util';

/** A season-page tab whose body the server already rendered — the survey form, the superlatives
 *  ballot, or the superlatives results. */
export interface FeedbackTab {
  key: 'survey' | 'superlatives';
  label: string;
  content: ReactNode;
}

export default function TopTabBar<T extends string>({
  tabs,
  tab,
  setTab,
}: {
  tabs: { key: T; label: string }[];
  tab: T;
  setTab: (t: T) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap border-b border-[var(--color-border-primary)] mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => setTab(t.key)}
          className={tabCls(tab === t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
