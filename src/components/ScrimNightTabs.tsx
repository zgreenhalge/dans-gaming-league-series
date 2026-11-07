'use client';

// The scrim night page's tabs. The server renders each tab's body (the lobby and match list need
// server-only props); this owns the bar and the URL-backed selection (`?tab=`).

import type { ReactNode } from 'react';
import TopTabBar from './TopTabBar';
import { resolveTab, useTabState } from './useTabState';

export const SCRIM_NIGHT_TABS = ['lobby', 'matches', 'leaderboard', 'h2h'] as const;
export type ScrimNightTab = (typeof SCRIM_NIGHT_TABS)[number];

export interface ScrimNightTabSpec {
  key: ScrimNightTab;
  label: string;
  content: ReactNode;
}

/** `tabs` are only those with something to show; `defaultTab` is the one a link with no `?tab=`
 *  opens on, and the first tab stands in when the URL names one that isn't present. */
export function ScrimNightTabs({ tabs, defaultTab }: { tabs: ScrimNightTabSpec[]; defaultTab: ScrimNightTab }) {
  const [rawTab, setTab] = useTabState(SCRIM_NIGHT_TABS, defaultTab);
  const tab = resolveTab(rawTab, tabs);
  return (
    <>
      <TopTabBar tabs={tabs} tab={tab} setTab={setTab} />
      {tabs.find((t) => t.key === tab)?.content}
    </>
  );
}
