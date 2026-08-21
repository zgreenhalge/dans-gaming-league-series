'use client';

import { useEffect, useMemo } from 'react';
import { seasonTitle } from '@/lib/util';
import { useUrlState, useSetUrlParams } from './useUrlState';

// ─── Checkbox ────────────────────────────────────────────────────────────────

export function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none group">
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); }
        }}
        className={[
          'w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]',
          checked
            ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)]'
            : 'border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]',
        ].join(' ')}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="var(--color-bg-primary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span
        onClick={onToggle}
        className="tracked text-[11px] font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors"
      >
        {label}
      </span>
    </label>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface SeasonFilterState {
  includeRegular: boolean;
  includeGauntlet: boolean;
  selectedSeason: number | 'all';
  toggleRegular: () => void;
  toggleGauntlet: () => void;
  setSelectedSeason: (s: number | 'all') => void;
}

/**
 * URL-backed season filter — `reg`/`gnt` (`'0'` = off, omitted = on, the default) and `season`
 * (`'all'`, omitted, or a season id). Shared by every view that filters by season
 * (`CareerStatsView`, `PlayerView`, `MapDetailView`), so migrating it here fixes all of them at once
 * rather than requiring a separate migration per view.
 *
 * `resetSeasonOnToggle` — some call sites (`PlayerView`, `CareerStatsView`) unconditionally reset
 * their own season selection back to "all/career" whenever regular/gauntlet is toggled; others
 * (`MapDetailView`) don't — they rely on `SeasonFilter`'s own effect below, which only resets when
 * the *current* selection actually becomes invalid after the toggle, a more precise correction.
 * Both are real, pre-existing, intentionally different behaviors — not something this migration
 * should unify. Toggling `reg`/`gnt` and resetting `season` in the same click must land in one
 * navigation (`useSetUrlParams`, not two separate per-key writes): a second `useUrlState` setter
 * call in the same handler wouldn't see the first one's write yet and would silently drop it — see
 * `useSetUrlParams`'s docstring.
 */
export function useSeasonFilter(options?: { resetSeasonOnToggle?: boolean }): SeasonFilterState {
  const [regRaw, setRegRaw] = useUrlState<'0' | '1'>('reg', '1');
  const [gntRaw, setGntRaw] = useUrlState<'0' | '1'>('gnt', '1');
  const [seasonRaw, setSeasonRaw] = useUrlState('season', 'all', {
    parse: (raw) => (raw === 'all' || /^\d+$/.test(raw) ? raw : undefined),
  });
  const setUrlParams = useSetUrlParams();

  const includeRegular = regRaw !== '0';
  const includeGauntlet = gntRaw !== '0';
  const selectedSeason: number | 'all' = seasonRaw === 'all' ? 'all' : Number(seasonRaw);

  // Shared by `toggleRegular`/`toggleGauntlet` below — same guard (don't allow turning off the last
  // remaining filter) and the same `resetSeasonOnToggle` branch, differing only in which of `reg`/
  // `gnt` is being flipped.
  function toggle(mine: boolean, other: boolean, key: 'reg' | 'gnt', setRaw: (next: '0' | '1') => void) {
    if (mine && !other) return;
    if (options?.resetSeasonOnToggle) {
      setUrlParams({ [key]: mine ? '0' : undefined, season: undefined });
    } else {
      setRaw(mine ? '0' : '1');
    }
  }

  function toggleRegular() {
    toggle(includeRegular, includeGauntlet, 'reg', setRegRaw);
  }

  function toggleGauntlet() {
    toggle(includeGauntlet, includeRegular, 'gnt', setGntRaw);
  }

  function setSelectedSeason(s: number | 'all') {
    setSeasonRaw(s === 'all' ? 'all' : String(s));
  }

  return { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SeasonFilter({
  filter,
  seasons,
  onSeasonChange,
  showRegular = true,
  showGauntlet = true,
  className = 'flex items-center gap-5',
}: {
  filter: Pick<SeasonFilterState, 'includeRegular' | 'includeGauntlet' | 'toggleRegular' | 'toggleGauntlet' | 'selectedSeason'>;
  seasons?: { id: number; name: string; is_gauntlet: boolean }[];
  onSeasonChange?: (s: number | 'all') => void;
  showRegular?: boolean;
  showGauntlet?: boolean;
  className?: string;
}) {
  const { includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason } = filter;

  const visibleSeasons = useMemo(
    () =>
      seasons?.filter((s) => {
        if (!includeRegular && !s.is_gauntlet) return false;
        if (!includeGauntlet && s.is_gauntlet) return false;
        return true;
      }),
    [seasons, includeRegular, includeGauntlet],
  );

  // Deduplicate by season title so regular+gauntlet pairs appear as one entry
  const uniqueSeasons = useMemo(() => {
    if (!visibleSeasons) return undefined;
    const seen = new Set<string>();
    return visibleSeasons.filter((s) => {
      const t = seasonTitle(s.name);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }, [visibleSeasons]);

  // Reset to 'all' if the selected season is no longer visible
  useEffect(() => {
    if (
      selectedSeason !== 'all' &&
      onSeasonChange &&
      uniqueSeasons &&
      !uniqueSeasons.some((s) => s.id === selectedSeason)
    ) {
      onSeasonChange('all');
    }
  }, [selectedSeason, uniqueSeasons, onSeasonChange]);

  return (
    <div className={className}>
      {showRegular && <Checkbox checked={includeRegular} onToggle={toggleRegular} label="Regular Season" />}
      {showGauntlet && <Checkbox checked={includeGauntlet} onToggle={toggleGauntlet} label="Gauntlet" />}
      {uniqueSeasons && uniqueSeasons.length > 1 && onSeasonChange && (
        <select
          value={selectedSeason === 'all' ? 'all' : String(selectedSeason)}
          onChange={(e) => onSeasonChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
        >
          <option value="all">All seasons</option>
          {uniqueSeasons.map((s) => (
            <option key={s.id} value={s.id}>{seasonTitle(s.name)}</option>
          ))}
        </select>
      )}
    </div>
  );
}
