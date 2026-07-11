'use client';

import { useState, useMemo } from 'react';
import LeaderboardTable from './LeaderboardTable';
import ScheduleList from './ScheduleList';
import GauntletStandings from './GauntletStandings';
import GauntletRoundsList from './GauntletRoundsList';
import { GauntletBracketDiagram } from './GauntletBracketDiagram';
import H2HSection from './H2HSection';
import { BasicStatsView } from './BasicStatsView';
import SabremetricsLeaderboardView from './SabremetricsLeaderboardView';
import TabBar from './TabBar';
import type { WeekWithMatches, GauntletRound, BracketPod, H2HData, SabremetricMatchRow } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { MatchPickBanInput } from '@/lib/mapSideStats';
import { isPlayedScore, tabCls, canonicalGauntletRankMap } from '@/lib/util';
import { projectGauntletSeeding, type SeedPlacement } from '@/lib/gauntlet-bracket';

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

type RegularMode = { kind: 'regular'; schedule: WeekWithMatches[]; seasonStartDate: string | null };
type GauntletMode = {
  kind: 'gauntlet';
  rounds: GauntletRound[];
  bracketShape: BracketPod[];
  /** Seed number → player name from the paired regular season's current standings — lets the
   *  bracket diagram name an unseeded seed slot before the gauntlet is actually seeded. */
  seedNames?: Map<number, string>;
};

export type { Tab as SeasonTab };

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
};

export default function SeasonTabView(props: SeasonTabViewProps) {
  const { leaderboard, seasonStatus, currentPlayerId, subStyle, h2hData, ehogRatings, sabremetrics } = props;
  const hasSab = !!sabremetrics && sabremetrics.length > 0;
  const isGauntlet = props.kind === 'gauntlet';
  const schedule = props.kind === 'regular' ? props.schedule : EMPTY_SCHEDULE;
  const rounds = props.kind === 'gauntlet' ? props.rounds : EMPTY_ROUNDS;
  const bracketShape = props.kind === 'gauntlet' ? props.bracketShape : EMPTY_BRACKET_SHAPE;
  const seasonStartDate = props.kind === 'regular' ? props.seasonStartDate : null;
  const seedNames = props.kind === 'gauntlet' ? props.seedNames : undefined;

  const gauntletRanking = useMemo(
    () => (isGauntlet ? canonicalGauntletRankMap(rounds) : undefined),
    [isGauntlet, rounds],
  );

  // Live "if the season ended today" gauntlet seeding preview for an in-progress regular season —
  // only meaningful before a real gauntlet exists, which is exactly while status is ACTIVE (the
  // real one is only ever built once this season is archived and the next activates). `leaderboard`
  // is already in canonical-sort order (getSeasonLeaderboard sorts it), which is the seeding order
  // itself: index 0 = seed 1.
  const gauntletSeeding = useMemo<Map<number, SeedPlacement> | undefined>(() => {
    if (isGauntlet || seasonStatus !== 'ACTIVE') return undefined;
    const placementBySeed = projectGauntletSeeding(leaderboard.length);
    if (!placementBySeed) return undefined;
    const byPlayer = new Map<number, SeedPlacement>();
    leaderboard.forEach((row, i) => {
      const placement = placementBySeed.get(i + 1);
      if (placement) byPlayer.set(row.player_id, placement);
    });
    return byPlayer;
  }, [isGauntlet, seasonStatus, leaderboard]);

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

  const [localTab, setLocalTab] = useState<Tab>('leaderboard');
  const rawTab = props.tab ?? localTab;
  const setTab = props.onTabChange ?? setLocalTab;

  // A tab with nothing behind it (e.g. a gauntlet before any pod is seeded) is hidden rather than
  // shown with a "nothing here yet" message — mirrors the H2H empty check in `H2HSection`.
  const hasLeaderboard = leaderboard.length > 0;
  const hasStats = leaderboard.length > 0;
  const hasH2H = h2hData.players.length > 0 && (h2hData.duos.length > 0 || h2hData.rivals.length > 0);
  const hasSchedule = isGauntlet ? bracketShape.length > 0 || rounds.length > 0 : schedule.length > 0;
  const [myGamesOnly, setMyGamesOnly] = useState(false);
  const [openItems, setOpenItems] = useState<Set<number>>(defaultOpenSet);

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
    }));
  }, [isGauntlet, rounds, schedule]);

  const allOpen = isGauntlet
    ? displayRounds.length > 0 && displayRounds.every((r) => openItems.has(r.round_number))
    : displaySchedule.length > 0 && displaySchedule.every((w) => openItems.has(w.id));

  function toggleItem(id: number) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOpen) {
      setOpenItems(new Set());
    } else if (isGauntlet) {
      setOpenItems(new Set(displayRounds.map((r) => r.round_number)));
    } else {
      setOpenItems(new Set(displaySchedule.map((w) => w.id)));
    }
  }

  function toggleMyGames() {
    const next = !myGamesOnly;
    setMyGamesOnly(next);
    if (next && currentPlayerId) {
      setOpenItems(
        isGauntlet
          ? new Set(myRounds.map((r) => r.round_number))
          : new Set(mySchedule.map((w) => w.id)),
      );
    } else {
      setOpenItems(defaultOpenSet);
    }
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
  const tab = tabs.some((t) => t.key === rawTab) ? rawTab : (tabs[0]?.key ?? rawTab);

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

      {tab === 'leaderboard' && (
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

      {tab === 'schedule' && (
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

      {tab === 'stats' && <BasicStatsView rows={leaderboard} matches={allMatches} />}

      {tab === 'advanced' && hasSab && (
        <SabremetricsLeaderboardView rows={sabremetrics!} />
      )}

      {tab === 'h2h' && <H2HSection data={h2hData} />}
    </>
  );
}
