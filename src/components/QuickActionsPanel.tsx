'use client';

// Always-visible shortcuts for the admin console's most reached-for global tools — actions that
// don't belong to one match/player/season, so tucking them a tab and a sub-tab deep (Manage → Match)
// buried them behind navigation for no reason. Sits above the Activity/Manage tabs, next to the
// always-visible server panel. `demoMatchIds` is fetched once by the parent `AdminConsole` (shared
// with `MatchManager`'s per-row indicator) rather than re-fetched here.

import { BulkReparseButton } from './BulkReparseButton';
import SectionLabel from './SectionLabel';

export function QuickActionsPanel({ demoMatchIds }: { demoMatchIds: Set<number> | null }) {
  if (!demoMatchIds || demoMatchIds.size === 0) return null;

  return (
    <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-3">
      <SectionLabel>Quick actions</SectionLabel>
      <BulkReparseButton matchIds={[...demoMatchIds]} />
    </div>
  );
}
