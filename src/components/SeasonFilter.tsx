'use client';

import { useMemo } from 'react';
import { dedupeVisibleSeasons, seasonTitle, seasonsInScope } from '@/lib/util';
import { useUrlState } from './useUrlState';

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
 * (`CareerStatsView`, `PlayerView`, `MapDetailView`, `MapIndexView`), so `reg`/`gnt` are URL-backed
 * for all of them through this one hook rather than a separate migration per view.
 *
 * `regularSeasons`/`gauntletSeasons` — a caller's full season lists (unfiltered by `reg`/`gnt`).
 * When given, `selectedSeason` clamps to `'all'` on every read whenever the raw URL value doesn't
 * name an id currently `seasonsInScope()` of this hook's own `includeRegular`/`includeGauntlet`
 * flags — a pure derive-at-read fallback, the same shape as `resolveTab()` (`useTabState.ts`).
 * Toggling `reg`/`gnt` needs no special-casing of `season`: the very next render's include-flags
 * already reflect the toggle, so a selection that's no longer in scope self-corrects with no effect
 * and no second navigation.
 */
export function useSeasonFilter(options?: {
  regularSeasons?: { id: number }[];
  gauntletSeasons?: { id: number }[];
}): SeasonFilterState {
  const [regRaw, setRegRaw] = useUrlState<'0' | '1'>('reg', '1');
  const [gntRaw, setGntRaw] = useUrlState<'0' | '1'>('gnt', '1');
  const [seasonRaw, setSeasonRaw] = useUrlState('season', 'all', {
    parse: (raw) => (raw === 'all' || /^\d+$/.test(raw) ? raw : undefined),
  });

  const includeRegular = regRaw !== '0';
  const includeGauntlet = gntRaw !== '0';
  const rawSelectedSeason: number | 'all' = seasonRaw === 'all' ? 'all' : Number(seasonRaw);

  const hasValidityInput = options?.regularSeasons !== undefined || options?.gauntletSeasons !== undefined;
  const inScope = seasonsInScope(options?.regularSeasons ?? [], options?.gauntletSeasons ?? [], includeRegular, includeGauntlet);
  const selectedSeason: number | 'all' =
    hasValidityInput && rawSelectedSeason !== 'all' && !inScope.some((s) => s.id === rawSelectedSeason)
      ? 'all'
      : rawSelectedSeason;

  function toggleRegular() {
    if (includeRegular && !includeGauntlet) return;
    setRegRaw(includeRegular ? '0' : '1');
  }

  function toggleGauntlet() {
    if (includeGauntlet && !includeRegular) return;
    setGntRaw(includeGauntlet ? '0' : '1');
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

// ─── Career-vocabulary variant ─────────────────────────────────────────────────

/**
 * `SeasonFilter`'s checkboxes plus a season `<select>` labeled "Career" (not "All seasons") for the
 * aggregate option, for the two views (`PlayerView`, `CareerStatsView`) that use "Career" as their
 * own vocabulary for `useSeasonFilter`'s `'all'`. `MapDetailView` doesn't need this variant — it uses
 * `SeasonFilter`'s own built-in `seasons`/`onSeasonChange` dropdown directly, and "All seasons" is the
 * right copy there.
 *
 * Bundles `dedupeVisibleSeasons()` (the "filter by include flags, dedupe by `seasonTitle()`" logic
 * `SeasonFilter`'s own dropdown also does, independently, since the two dropdowns take different input
 * shapes — this one takes already-split `regularSeasons`/`gauntletSeasons`, not a single flagged list)
 * so call sites don't each recompute it themselves just for this control; a call site that also needs
 * the deduplicated list for something else (`PlayerView`'s season recap) computes its own copy via the
 * same `dedupeVisibleSeasons()` — cheap enough that having two independently-memoized copies isn't
 * worth threading through as a prop.
 */
export function CareerSeasonControls({
  includeRegular,
  includeGauntlet,
  toggleRegular,
  toggleGauntlet,
  regularSeasons,
  gauntletSeasons,
  selectedSeason,
  setSelectedSeason,
}: {
  includeRegular: boolean;
  includeGauntlet: boolean;
  toggleRegular: () => void;
  toggleGauntlet: () => void;
  regularSeasons: { id: number; name: string }[];
  gauntletSeasons: { id: number; name: string }[];
  selectedSeason: number | 'all';
  setSelectedSeason: (s: number | 'all') => void;
}) {
  const activeSeasons = useMemo(
    () => dedupeVisibleSeasons(regularSeasons, gauntletSeasons, includeRegular, includeGauntlet),
    [regularSeasons, gauntletSeasons, includeRegular, includeGauntlet],
  );

  return (
    <>
      <SeasonFilter
        filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason: 'all' }}
        showRegular={regularSeasons.length > 0}
        showGauntlet={gauntletSeasons.length > 0}
      />
      <select
        value={String(selectedSeason)}
        onChange={(e) => {
          const v = e.target.value;
          setSelectedSeason(v === 'all' ? 'all' : Number(v));
        }}
        className="tracked text-[11px] font-semibold border border-[var(--color-border-primary)] px-2.5 py-1 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <option value="all">Career</option>
        {activeSeasons.map((s) => (
          <option key={s.id} value={s.id}>
            {seasonTitle(s.name)}
          </option>
        ))}
      </select>
    </>
  );
}
