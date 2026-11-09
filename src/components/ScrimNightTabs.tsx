'use client';

// The scrim night page's tabs. The server renders each tab's body (the lobby and match list need
// server-only props); this owns the bar and the URL-backed selection (`?tab=`).

import type { ReactNode } from 'react';
import TopTabBar from './TopTabBar';
import { resolveTab, useTabState } from './useTabState';
import { SCRIM_NIGHT_TABS, type ScrimNightTab } from '@/lib/scrim-night-page';

export interface ScrimNightTabSpec {
  key: ScrimNightTab;
  label: string;
  content: ReactNode;
}

/** `tabs` are only those with something to show, in display order (`scrimNightTabOrder()`). A link with no `?tab=`, or one
 *  naming a tab that isn't present, opens on the first. */
export function ScrimNightTabs({ tabs }: { tabs: ScrimNightTabSpec[] }) {
  const [rawTab, setTab] = useTabState(SCRIM_NIGHT_TABS, tabs[0].key);
  const tab = resolveTab(rawTab, tabs);
  return (
    <>
      <TopTabBar tabs={tabs} tab={tab} setTab={setTab} />
      {tabs.find((t) => t.key === tab)?.content}
    </>
  );
}
