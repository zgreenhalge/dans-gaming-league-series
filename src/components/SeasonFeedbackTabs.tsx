'use client';

// Top-level tabs for a season page that has no gauntlet tab (`CombinedSeasonTabView` owns the bar
// when there is one): the season's own content plus the Survey / Superlatives tabs. Only rendered
// when at least one feedback tab exists, so a season with nothing to ask or show keeps its plain
// layout.

import type { ReactNode } from 'react';
import TopTabBar, { type FeedbackTab } from './TopTabBar';
import { resolveTab, useTabState } from './useTabState';

type Key = 'season' | FeedbackTab['key'];
const KEYS: readonly Key[] = ['season', 'survey', 'superlatives'];

export function SeasonFeedbackTabs({ feedbackTabs, children }: { feedbackTabs: FeedbackTab[]; children: ReactNode }) {
  const [rawTab, setTab] = useTabState(KEYS, 'season', 'view');
  const tabs: { key: Key; label: string }[] = [
    { key: 'season', label: 'Season' },
    ...feedbackTabs,
  ];
  const tab = resolveTab(rawTab, tabs);

  return (
    <>
      <TopTabBar tabs={tabs} tab={tab} setTab={setTab} />
      {tab === 'season' ? children : feedbackTabs.find((t) => t.key === tab)?.content}
    </>
  );
}
