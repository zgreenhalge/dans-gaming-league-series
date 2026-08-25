'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTabState, resolveTab } from './useTabState';
import { useUrlState, useSetUrlParams } from './useUrlState';
import { useUrlStateContext } from './UrlStateProvider';
import LeaderboardTable from './LeaderboardTable';
import ScheduleList from './ScheduleList';
import GauntletStandings from './GauntletStandings';
import GauntletRoundsList from './GauntletRoundsList';
import { GauntletBracketDiagram } from './GauntletBracketDiagram';
import H2HSection from './H2HSection';
import { useH2HPairUrlState } from './useH2HPairUrlState';
import { BasicStatsView } from './BasicStatsView';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import TabBar from './TabBar';
import type { WeekWithMatches, GauntletRound, BracketPod, H2HData, SabremetricMatchRow, MatchRoundRow, MatchKillRow } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { MatchPickBanInput } from '@/lib/mapSideStats';
import { isPlayedScore, tabCls, weekAnchorId, roundAnchorId } from '@/lib/util';
import { canonicalGauntletRankMap } from '@/lib/gauntlet-ranking';
import { projectGauntletSeeding, seedPlacementsByPlayer, type SeedPlacement } from '@/lib/gauntlet-bracket';

type Tab = 'leaderboard' | 'schedule' | 'h2h' | 'stats' | 'advanced';

function playerInMatch(
  match: { shirts_stats: { player_id: number }[]; skins_stats: { player_id: number }[] },
  playerId: number,
): boolean {
  return (
    match.shirts_stats.some((p) => p.player_id === playerId) ||
    match.skins_stats.some((p) => p.player_id === playerId)
  );
}

// The `week`/`round` param's id-set encoding: a comma-separated list of ids ("1,3,5"). An explicit
// empty string means "the user collapsed everything, open nothing" — distinct from the param being
// absent, which `useUrlState` already resolves to the default-open heuristic on its own.
function idsFromRawOpen(raw: string): number[] {
  return raw === '' ? [] : raw.split(',').map(Number);
}

function serializeIdSet(ids: Set<number>): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

type RegularMode = {
  kind: 'regular';
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  /** The season's regular-season map pool — feeds the Bans/No-picks columns in the Maps & Sides tab. */
  mapPool?: string[] | null;
  /** The paired gauntlet's real, materialized bracket shape, once one exists — lets this season's
   *  own leaderboard prefer real seed-placement data over the theoretical live projection. See the
   *  `gauntletSeeding` memo below. */
  gauntletBracketShape?: BracketPod[];
};
type GauntletMode = {
  kind: 'gauntlet';
  rounds: GauntletRound[];
  bracketShape: BracketPod[];
  /** Seed number → player name from the paired regular season's current standings — lets the
   *  bracket diagram name an unseeded seed slot before the gauntlet is actually seeded. */
  seedNames?: Map<number, string>;
};

export type { Tab as SeasonTab };

// Every possible tab key, for `useTabState`'s own missing/invalid-param fallback. This is broader
// than what's actually shown for a given season — the `resolveTab(...)` call further down still
// hides tabs with no data behind them — but `useTabState` needs a fixed list to validate against.
// Exported so `CombinedSeasonTabView`'s own `subTab` (shared between this component's regular and
// gauntlet instances) validates against the same list instead of a second, driftable copy.
export const SEASON_TABS: readonly Tab[] = ['leaderboard', 'stats', 'advanced', 'h2h', 'schedule'];

// Stable empty-array fallbacks so `schedule`/`rounds` keep a consistent identity across
// renders when the season is the other kind — a fresh `[]` literal here would break the
// downstream `useMemo` dependency checks below.
const EMPTY_SCHEDULE: WeekWithMatches[] = [];
const EMPTY_ROUNDS: GauntletRound[] = [];
const EMPTY_BRACKET_SHAPE: BracketPod[] = [];

type SeasonTabViewProps = (RegularMode | GauntletMode) & {
  leaderboard: LeaderboardRowWithId[];
  seasonStatus: string;
  currentPlayerId: number | null;
  subStyle?: boolean;
  h2hData: H2HData;
  tab?: Tab;
  onTabChange?: (t: Tab) => void;
  ehogRatings?: Record<number, number>;
  /** This season's per-match sabremetrics — the Advanced Stats tab only shows once at least
   *  one match here has a parsed demo. */
  sabremetrics?: SabremetricMatchRow[];
  /** This season's demo-derived round outcomes — feeds the Maps & Sides tab's round-win-%-by-side
   *  column. Empty for matches with no parsed demo. */
  matchRounds?: MatchRoundRow[];
  /** This season's demo-derived kills — feeds the Advanced tab's Weapons sub-tab. Empty for
   *  matches with no parsed demo. */
  matchKills?: MatchKillRow[];
};

export default function SeasonTabView(props: SeasonTabViewProps) {
  const { leaderboard, seasonStatus, currentPlayerId, subStyle, h2hData, ehogRatings, sabremetrics, matchRounds, matchKills } = props;
  const hasSab = !!sabremetrics && sabremetrics.length > 0;
  const isGauntlet = props.kind === 'gauntlet';
  const schedule = props.kind === 'regular' ? props.schedule : EMPTY_SCHEDULE;
  const rounds = props.kind === 'gauntlet' ? props.rounds : EMPTY_ROUNDS;
  const bracketShape = props.kind === 'gauntlet' ? props.bracketShape : EMPTY_BRACKET_SHAPE;
  const seasonStartDate = props.kind === 'regular' ? props.seasonStartDate : null;
  const seedNames = props.kind === 'gauntlet' ? props.seedNames : undefined;
  const mapPool = props.kind === 'regular' ? (props.mapPool ?? null) : null;
  const gauntletBracketShape = props.kind === 'regular' ? (props.gauntletBracketShape ?? EMPTY_BRACKET_SHAPE) : EMPTY_BRACKET_SHAPE;

  const gauntletRanking = useMemo(
    () => (isGauntlet ? canonicalGauntletRankMap(rounds) : undefined),
    [isGauntlet, rounds],
  );

  // Seed-placement row tinting for a regular season's own leaderboard — gold for a bye, red for a
  // seed that wouldn't fit the bracket. Never shown on a gauntlet's own leaderboard: that view gets
  // a podium once the gauntlet completes (`GauntletStandings`) and has nothing worth tinting rows
  // for before then.
  //
  // Two sources, in preference order:
  //   1. A real, materialized bracket for the paired gauntlet, once one exists
  //      (`gauntletBracketShape`) — read directly off `gauntlet_pod_slots` rather than computed, so
  //      it reflects reality even if the bracket was hand-edited away from the shape
  //      `buildGauntletBracket()` would have produced. A seed-sourced slot in the final pod itself is
  //      a real bye — a seed placed directly into an intermediate round still has to play it, so
  //      that's not a bye. Preferred unconditionally whenever it has real data, regardless of season
  //      status — a real bracket is never wrong to prefer over a guess.
  //   2. Otherwise, while this season is ACTIVE, a live "if the season ended today" projection from
  //      the *current standings*, since no gauntlet exists yet (`projectGauntletSeeding`).
  //      `leaderboard` is already in canonical-sort order (`getSeasonLeaderboard` sorts it), which
  //      is the seeding order itself: index 0 = seed 1.
  const gauntletSeeding = useMemo<Map<number, SeedPlacement> | undefined>(() => {
    if (isGauntlet) return undefined;

    if (gauntletBracketShape.length > 0) {
      const byPlayer = seedPlacementsByPlayer(gauntletBracketShape);
      if (byPlayer.size > 0) return byPlayer;
    }

    if (seasonStatus !== 'ACTIVE') return undefined;
    const placementBySeed = projectGauntletSeeding(leaderboard.length);
    if (!placementBySeed) return undefined;
    const byPlayer = new Map<number, SeedPlacement>();
    leaderboard.forEach((row, i) => {
      const placement = placementBySeed.get(i + 1);
      if (placement) byPlayer.set(row.player_id, placement);
    });
    return byPlayer;
  }, [isGauntlet, seasonStatus, leaderboard, gauntletBracketShape]);

  const defaultOpenSet = useMemo<Set<number>>(() => {
    if (isGauntlet) {
      const idx = rounds.findIndex((r) => r.matches.some((m) => !isPlayedScore(m.final_score)));
      if (idx !== -1) return new Set([rounds[idx].round_number]);
      if (rounds.length > 0) return new Set([rounds[rounds.length - 1].round_number]);
    } else {
      const idx = schedule.findIndex((w) => w.matches.some((m) => !isPlayedScore(m.final_score)));
      if (idx !== -1) return new Set([schedule[idx].id]);
      if (schedule.length > 0) return new Set([schedule[schedule.length - 1].id]);
    }
    return new Set();
  }, [isGauntlet, rounds, schedule]);

  const [localTab, setLocalTab] = useTabState(SEASON_TABS, 'leaderboard');
  const rawTab = props.tab ?? localTab;
  const setTab = props.onTabChange ?? setLocalTab;

  // A tab with nothing behind it (e.g. a gauntlet before any pod is seeded) is hidden rather than
  // shown with a "nothing here yet" message — mirrors the H2H empty check in `H2HSection`.
  // A regular season's leaderboard and stats both hide while its roster is still open for edit
  // (UPCOMING, see SeasonRosterPanel): getSeasonLeaderboard() merges in zero-stat placeholder rows
  // for every rostered player regardless of whether a match exists yet, so `leaderboard.length > 0`
  // alone is true from roster size — any rows at that point are leftover/placeholder, not real
  // standings, for either tab.
  const notRealStandingsYet = !isGauntlet && seasonStatus === 'UPCOMING';
  const hasLeaderboard = leaderboard.length > 0 && !notRealStandingsYet;
  const hasStats = leaderboard.length > 0 && !notRealStandingsYet;
  const hasH2H = h2hData.players.length > 0 && (h2hData.duos.length > 0 || h2hData.rivals.length > 0);
  const hasSchedule = isGauntlet ? bracketShape.length > 0 || rounds.length > 0 : schedule.length > 0;

  // "My games" is URL state too (`mine=1`, omitted when off) — not just for its own sake, but
  // because it changes what a shared `week`/`round` link *means*: those ids are drawn from the
  // "my games"-filtered week/round list while it's active (see `toggleMyGames` below), so a link
  // that carries the ids without also carrying `mine=1` would show a teammate a schedule with the
  // wrong weeks pre-expanded and no visible reason why.
  const [myGamesRaw] = useUrlState<'0' | '1'>('mine', '0');
  const myGamesOnly = myGamesRaw === '1';

  // Which weeks/rounds are expanded is itself URL state (issue #90's "the exact view can be easily
  // shared" ask) — `?week=<ids>` (regular season) or `?round=<ids>` (gauntlet), a comma-separated id
  // list, replacing (not pushing — expand/collapse shouldn't spam the back button) on every toggle.
  // Built on `useUrlState` rather than hand-rolled: its `parse` option both validates each id against
  // this season's actual weeks/rounds (dropping ones that don't exist) *and* signals "fall back to
  // `defaultOpenSet`" by returning `undefined` when every id in a non-empty override turns out
  // invalid (a stale or hand-edited link) — that's different from an explicit empty string, which
  // `useUrlState` passes through untouched as "the user collapsed everything, open nothing." Writing
  // a set that serializes to the same string as `defaultOpenSet` omits the param entirely, via
  // `useUrlState`'s own "writing the default removes the param" behavior — no separate comparison
  // needed here.
  const { searchParams } = useUrlStateContext();
  const setUrlParams = useSetUrlParams();
  const { initialPair: urlInitialPair, onPairChange: handleH2HPairChange } = useH2HPairUrlState(h2hData.players);

  const openParam = isGauntlet ? 'round' : 'week';
  const itemExists = (id: number) => (isGauntlet ? rounds.some((r) => r.round_number === id) : schedule.some((w) => w.id === id));

  const [rawOpen, setRawOpen] = useUrlState(openParam, serializeIdSet(defaultOpenSet), {
    parse: (raw) => {
      if (raw === '') return raw;
      const valid = serializeIdSet(new Set(idsFromRawOpen(raw).filter((id) => Number.isFinite(id) && itemExists(id))));
      return valid === '' ? undefined : valid;
    },
  });

  const openItems = useMemo<Set<number>>(() => new Set(idsFromRawOpen(rawOpen)), [rawOpen]);

  function writeOpenItems(next: Set<number>) {
    setRawOpen(serializeIdSet(next));
  }

  // Scrolls to the lowest explicitly-open id from a shared link, once on mount — not on every
  // `openItems` change, which would yank the page around on every expand/collapse click.
  // Re-validates the *raw* param itself rather than reading `rawOpen` (which is always a resolved
  // string — the default-open fallback included, once `useUrlState`'s `parse` rejects an all-invalid
  // override) — otherwise a stale/typo'd link like `?week=999` would still scroll to wherever the
  // default happened to land, an unsolicited jump on what's otherwise a plain page load. Pair
  // `week`/`round` with `tab=schedule` in a shared link so the Schedule tab is already showing when
  // this fires; this alone doesn't switch tabs.
  const [scrollTargetId] = useState<number | null>(() => {
    const raw = searchParams.get(openParam);
    if (raw == null || raw === '') return null;
    const ids = idsFromRawOpen(raw).filter((id) => Number.isFinite(id) && itemExists(id));
    return ids.length > 0 ? Math.min(...ids) : null;
  });

  useEffect(() => {
    if (scrollTargetId == null) return;
    const anchorId = isGauntlet ? roundAnchorId(scrollTargetId) : weekAnchorId(scrollTargetId);
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollTargetId, isGauntlet]);

  const mySchedule = useMemo(
    () =>
      currentPlayerId
        ? schedule
            .map((w) => ({ ...w, matches: w.matches.filter((m) => playerInMatch(m, currentPlayerId)) }))
            .filter((w) => w.matches.length > 0)
        : schedule,
    [schedule, currentPlayerId],
  );

  const myRounds = useMemo(
    () =>
      currentPlayerId
        ? rounds
            .map((r) => ({ ...r, matches: r.matches.filter((m) => playerInMatch(m, currentPlayerId)) }))
            .filter((r) => r.matches.length > 0)
        : rounds,
    [rounds, currentPlayerId],
  );

  const displaySchedule = myGamesOnly ? mySchedule : schedule;
  const displayRounds = myGamesOnly ? myRounds : rounds;
  const displayCount = isGauntlet ? displayRounds.length : displaySchedule.length;

  const allMatches = useMemo<MatchPickBanInput[]>(() => {
    if (isGauntlet) {
      return rounds.flatMap((r) => r.matches).map((m) => ({
        final_score: m.final_score,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_stats: m.shirts_stats,
        skins_stats: m.skins_stats,
      }));
    }
    return schedule.flatMap((w) => w.matches).map((m) => ({
      final_score: m.final_score,
      picked_map: m.picked_map,
      shirts_pick: m.shirts_pick,
      skins_starting_side: m.skins_starting_side,
      shirts_stats: m.shirts_stats,
      skins_stats: m.skins_stats,
      shirts_ban: m.shirts_ban,
      shirts_ban2: m.shirts_ban2,
      skins_ban1: m.skins_ban1,
      skins_ban2: m.skins_ban2,
      is_playoff_game: m.is_playoff_game,
      map_pool: mapPool,
    }));
  }, [isGauntlet, rounds, schedule, mapPool]);

  const allOpen = isGauntlet
    ? displayRounds.length > 0 && displayRounds.every((r) => openItems.has(r.round_number))
    : displaySchedule.length > 0 && displaySchedule.every((w) => openItems.has(w.id));

  function toggleItem(id: number) {
    const next = new Set(openItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeOpenItems(next);
  }

  function toggleAll() {
    if (allOpen) {
      writeOpenItems(new Set());
    } else if (isGauntlet) {
      writeOpenItems(new Set(displayRounds.map((r) => r.round_number)));
    } else {
      writeOpenItems(new Set(displaySchedule.map((w) => w.id)));
    }
  }

  function toggleMyGames() {
    // Writes `mine` and the open-items param atomically (via `setUrlParams`, not the `useUrlState`
    // setter above) — two separate URL writes in one handler would clobber each other, since the
    // second call's `useSetUrlParams` snapshot doesn't see the first call's change until the next
    // render (see that hook's docstring on why it keeps a post-commit-synced ref).
    const next = !myGamesOnly;
    const nextOpen = next && currentPlayerId
      ? (isGauntlet ? new Set(myRounds.map((r) => r.round_number)) : new Set(mySchedule.map((w) => w.id)))
      : defaultOpenSet;
    const serializedOpen = serializeIdSet(nextOpen);
    setUrlParams({
      mine: next ? '1' : undefined,
      [openParam]: serializedOpen === serializeIdSet(defaultOpenSet) ? undefined : serializedOpen,
    });
  }

  const tabs: { key: Tab; label: string }[] = [
    ...(hasLeaderboard ? [{ key: 'leaderboard' as const, label: 'Leaderboard' }] : []),
    ...(hasStats ? [{ key: 'stats' as const, label: 'Stats' }] : []),
    ...(hasSab ? [{ key: 'advanced' as const, label: 'Advanced Stats' }] : []),
    ...(hasH2H ? [{ key: 'h2h' as const, label: 'H2H' }] : []),
    ...(hasSchedule ? [{ key: 'schedule' as const, label: isGauntlet ? 'Rounds' : 'Schedule' }] : []),
  ];
  // Falls back to the first surviving tab when the caller-controlled `tab` (shared between the
  // regular and gauntlet sub-views in `CombinedSeasonTabView`) points at one this side has hidden.
  const tab = resolveTab(rawTab, tabs);

  // Scrolls to the default-open week/round whenever the Schedule/Rounds tab becomes active with no
  // explicit `week`/`round` override (that case already scrolls via `scrollTargetId` above) — without
  // this, switching to the tab expands the current week but leaves the page wherever it already was,
  // which can be well above it in a season with many played weeks.
  useEffect(() => {
    if (tab !== 'schedule' || scrollTargetId != null) return;
    const [firstDefault] = defaultOpenSet;
    if (firstDefault == null) return;
    const anchorId = isGauntlet ? roundAnchorId(firstDefault) : weekAnchorId(firstDefault);
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [tab, scrollTargetId, isGauntlet, defaultOpenSet]);

  const scheduleControls = tab === 'schedule' && (
    <>
      {currentPlayerId !== null && (
        <button
          onClick={toggleMyGames}
          className={`tracked text-[10px] font-semibold px-2 py-1 border transition-colors ${
            myGamesOnly
              ? 'text-[var(--color-text-primary)] border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]'
              : 'text-[var(--color-text-secondary)] border-[var(--color-border-primary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]'
          }`}
        >
          My games
        </button>
      )}
      {displayCount > 1 && (
        <button
          onClick={toggleAll}
          className="tracked text-[9px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      )}
    </>
  );

  const tabBarButtons = tabs.map((t) => (
    <button
      key={t.key}
      role="tab"
      aria-selected={tab === t.key}
      onClick={() => setTab(t.key)}
      className={tabCls(tab === t.key, { compact: subStyle, accent: subStyle })}
    >
      {t.label}
    </button>
  ));

  const tabBar = (
    <TabBar bordered={!subStyle} className="mb-6" controls={scheduleControls || undefined}>
      {tabBarButtons}
    </TabBar>
  );

  return (
    <>
      {tabBar}

      {tab === 'leaderboard' && hasLeaderboard && (
        <>
          {isGauntlet && <GauntletStandings rounds={rounds} leaderboard={leaderboard} />}
          <LeaderboardTable
            rows={leaderboard}
            showMedals={seasonStatus === 'ARCHIVED'}
            gauntletSeeding={gauntletSeeding}
            canonicalRanking={gauntletRanking}
            ehogRatings={ehogRatings}
          />
        </>
      )}

      {tab === 'schedule' && hasSchedule && (
        isGauntlet ? (
          <>
            {bracketShape.length > 0 && (
              <div className="mb-6">
                <GauntletBracketDiagram
                  pods={bracketShape}
                  currentPlayerId={currentPlayerId}
                  rankMap={gauntletRanking}
                  seedNames={seedNames}
                />
              </div>
            )}
            {rounds.length > 0 && (
              <GauntletRoundsList
                displayRounds={displayRounds}
                allRounds={rounds}
                openRounds={openItems}
                onToggleRound={toggleItem}
                currentPlayerId={currentPlayerId}
              />
            )}
          </>
        ) : (
          <ScheduleList
            displaySchedule={displaySchedule}
            openWeeks={openItems}
            onToggleWeek={toggleItem}
            seasonStartDate={seasonStartDate}
            currentPlayerId={currentPlayerId}
          />
        )
      )}

      {tab === 'stats' && hasStats && <BasicStatsView rows={leaderboard} matches={allMatches} rounds={matchRounds} />}

      {tab === 'advanced' && hasSab && (
        <SabremetricsLeaderboardView rows={sabremetrics!} kills={matchKills} />
      )}

      {tab === 'h2h' && hasH2H && <H2HSection data={h2hData} initialPair={urlInitialPair} onPairChange={handleH2HPairChange} />}
    </>
  );
}
