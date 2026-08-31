'use client';

// Always-visible shortcuts for the admin console's most reached-for global tools — actions that
// don't belong to one match/player/season, so tucking them a tab and a sub-tab deep (Manage → Match)
// buried them behind navigation for no reason. Sits above the Activity/Manage tabs, next to the
// always-visible server panel.

import { BulkReparseButton } from './BulkReparseButton';
import { useDemoMatchIds } from './useDemoMatchIds';

export function QuickActionsPanel() {
  const demoMatchIds = useDemoMatchIds();
  if (!demoMatchIds || demoMatchIds.size === 0) return null;

  return (
    <div className="border border-[var(--color-border-tertiary)] rounded px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
        Quick actions
      </div>
      <BulkReparseButton matchIds={[...demoMatchIds]} />
    </div>
  );
}
