'use client';

// Manage -> Season for the unified admin console (issue #262). Folds what used to be two separate
// pages (/admin/seasons/new, /admin/seasons/gauntlet) into one view, plus "go live" (previously only
// reachable from a season's own public page) since that's core season-admin work the original console
// split scattered. Every mutation here still goes through the existing, unmodified components
// (`CreateSeasonForm`, `CreateGauntletForm`, `GauntletLifecycleList`, `MarkSeasonActiveButton`) — this
// is composition, not new mutation logic.

import { useEffect, useRef, useState } from 'react';
import MarkSeasonActiveButton from './MarkSeasonActiveButton';
import { CreateSeasonForm } from './CreateSeasonForm';
import { CreateGauntletForm } from './CreateGauntletForm';
import { GauntletLifecycleList, type GauntletRow } from './GauntletLifecycleList';
import { OpsErrorList, type OpsErrorItem } from './OpsErrorList';

export interface SeasonSummary {
  id: number;
  name: string;
  status: string;
  isGauntlet: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-strong)] border-[var(--color-accent-green-border)]',
  UPCOMING: 'bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-strong)] border-[var(--color-accent-amber-border)]',
  COMPLETED: 'bg-[var(--color-accent-blue-bg)] text-[var(--color-accent-blue-strong)] border-[var(--color-accent-blue-border)]',
  ARCHIVED: 'border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]',
};

export function SeasonManager({
  allSeasons,
  eligibleForGauntlet,
  gauntletsInProgress,
  seasonOpsErrors,
  knownMaps,
  nextSeasonName,
  focusLabel,
}: {
  allSeasons: SeasonSummary[];
  eligibleForGauntlet: { id: number; name: string }[];
  gauntletsInProgress: GauntletRow[];
  seasonOpsErrors: OpsErrorItem[];
  knownMaps: string[];
  nextSeasonName: string;
  /** Set when an Activity-tab ops error jumps here — scrolls the matching season into view. */
  focusLabel?: string;
}) {
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusLabel) focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusLabel]);

  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <OpsErrorList items={seasonOpsErrors} />

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Seasons</div>
        <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden">
          {allSeasons.map((s) => (
            <div
              key={s.id}
              ref={s.name === focusLabel ? focusRef : undefined}
              className={`lift-row flex items-center justify-between gap-3 px-3 py-2.5 border-t border-[var(--color-border-tertiary)] first:border-t-0 ${
                s.name === focusLabel ? 'bg-[color-mix(in_srgb,var(--color-site-accent)_8%,transparent)]' : ''
              }`}
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="font-display text-[14px] font-semibold truncate">{s.name}</span>
                <span className={`inline-block font-mono text-[9px] uppercase tracking-wide px-1.5 py-[1px] rounded border shrink-0 ${STATUS_BADGE[s.status] ?? STATUS_BADGE.ARCHIVED}`}>
                  {s.status}
                </span>
              </div>
              {s.status === 'UPCOMING' && !s.isGauntlet && (
                <MarkSeasonActiveButton seasonId={s.id} canEdit seasonStatus={s.status} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="tracked text-[10px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
        >
          {showCreate ? 'Cancel' : `+ New Season (${nextSeasonName})`}
        </button>
        {showCreate && (
          <div className="mt-4">
            <CreateSeasonForm knownMaps={knownMaps} />
          </div>
        )}
      </div>

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Build Gauntlet</div>
        <CreateGauntletForm seasons={eligibleForGauntlet} />
      </div>

      {gauntletsInProgress.length > 0 && (
        <div>
          <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Existing Gauntlets</div>
          <GauntletLifecycleList seasons={gauntletsInProgress} />
        </div>
      )}
    </div>
  );
}
