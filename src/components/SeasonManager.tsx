'use client';

// Manage -> Season for the unified admin console (issue #262). Every season is one row; gauntlet
// build/seed/reset for that season lives inline in its own expansion instead of two separate
// season-pickers underneath (the old shape: a flat "Seasons" list, then a *second*, disconnected
// season dropdown to build a gauntlet, then a *third*, separate list to seed/reset one — three
// un-linked tools that each made you re-find the same season). A season is expandable exactly when
// it's an ACTIVE regular season with gauntlet-lifecycle work available; every other row (UPCOMING,
// COMPLETED, ARCHIVED, or a gauntlet season itself) is a plain, non-interactive line, with "go live"
// as the one action UPCOMING seasons get inline instead of behind an expand. Every mutation still
// goes through the existing, unmodified components (`CreateSeasonForm`, `CreateGauntletForm`,
// `GauntletLifecycleList`, `MarkSeasonActiveButton`) scoped to a single season — this is composition,
// not new mutation logic.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MarkSeasonActiveButton from './MarkSeasonActiveButton';
import DeleteSeasonButton from './DeleteSeasonButton';
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
  nextSeasonName,
  focusLabel,
}: {
  allSeasons: SeasonSummary[];
  eligibleForGauntlet: { id: number; name: string }[];
  gauntletsInProgress: GauntletRow[];
  seasonOpsErrors: OpsErrorItem[];
  nextSeasonName: string;
  /** Set when an Activity-tab ops error jumps here — opens and scrolls the matching season into view. */
  focusLabel?: string;
}) {
  const eligibleIds = new Set(eligibleForGauntlet.map((s) => s.id));
  const gauntletByRegularId = new Map(gauntletsInProgress.map((g) => [g.regularSeasonId, g]));
  const errorsByLabel = new Map(seasonOpsErrors.map((e) => [e.label, e]));

  // Only used for the jump-target lookup below, where there's no already-fetched `gauntletRow` to
  // derive this from — the row loop computes its own `canExpand` directly instead of calling this,
  // so the map isn't queried twice per row.
  function expandable(s: SeasonSummary): boolean {
    return s.status === 'ACTIVE' && !s.isGauntlet && (eligibleIds.has(s.id) || gauntletByRegularId.has(s.id));
  }

  // Opens the jump target's row at mount time. `AdminConsole` remounts this component (via `key`)
  // on every jump, so a lazy initializer that reads `focusLabel` directly is enough — no effect or
  // "previous value" comparison needed. Scrolling still needs a real effect below (refs aren't
  // attached yet during render).
  const [openId, setOpenId] = useState<number | null>(() => {
    const match = focusLabel ? allSeasons.find((s) => s.name === focusLabel) : undefined;
    return match && expandable(match) ? match.id : null;
  });

  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusLabel) focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusLabel]);

  return (
    <div className="flex flex-col gap-6">
      <OpsErrorList items={seasonOpsErrors} />

      <div>
        <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Seasons</div>
        <div className="border border-[var(--color-border-tertiary)] rounded overflow-hidden">
          {allSeasons.map((s) => {
            const isOpen = openId === s.id;
            const error = errorsByLabel.get(s.name);
            const gauntletRow = gauntletByRegularId.get(s.id);
            const canExpand = s.status === 'ACTIVE' && !s.isGauntlet && (eligibleIds.has(s.id) || !!gauntletRow);
            return (
              <div
                key={s.id}
                ref={s.name === focusLabel ? focusRef : undefined}
                className={`border-t border-[var(--color-border-tertiary)] first:border-t-0 ${
                  s.name === focusLabel ? 'bg-[color-mix(in_srgb,var(--color-site-accent)_8%,transparent)]' : ''
                }`}
              >
                {/* The chevron toggle and the season-name link are siblings, not nested — a <button>
                    can't legally contain an <a>, and the name should link out regardless of whether
                    this row has anything to expand. */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {canExpand && (
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : s.id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                      className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] w-3 shrink-0"
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/seasons/${s.id}`}
                        className="font-display text-[14px] font-semibold truncate hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className={`inline-block font-mono text-[9px] uppercase tracking-wide px-1.5 py-[1px] rounded border shrink-0 ${STATUS_BADGE[s.status] ?? STATUS_BADGE.ARCHIVED}`}>
                        {s.status}
                      </span>
                    </div>
                    {error && (
                      <div className="font-mono text-[10.5px] text-[var(--color-accent-red-fg)] mt-1 break-words">
                        ⚠ {error.message}
                      </div>
                    )}
                  </div>
                  {s.status === 'UPCOMING' && !s.isGauntlet && (
                    <div className="shrink-0 flex items-center gap-3">
                      <MarkSeasonActiveButton seasonId={s.id} canEdit seasonStatus={s.status} />
                      <DeleteSeasonButton seasonId={s.id} />
                    </div>
                  )}
                </div>

                {isOpen && canExpand && (
                  <div className="px-3 py-4 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border-tertiary)]">
                    {gauntletRow ? (
                      <GauntletLifecycleList seasons={[gauntletRow]} />
                    ) : (
                      <CreateGauntletForm seasons={[{ id: s.id, name: s.name }]} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Link
        href="/admin/seasons/new"
        className="tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all self-start"
      >
        {`+ New Season (${nextSeasonName})`}
      </Link>
    </div>
  );
}
