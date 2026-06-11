'use client';

import { useState, useMemo } from 'react';
import LeaderboardTable from './LeaderboardTable';
import ScheduleList from './ScheduleList';
import GauntletStandings from './GauntletStandings';
import GauntletRoundsList from './GauntletRoundsList';
import H2HSection from './H2HSection';
import { AdvancedStatsView } from './AdvancedStatsView';
import type { WeekWithMatches, GauntletRound, H2HData } from '@/lib/queries';
import type { LeaderboardRowWithId } from '@/lib/types';
import type { MatchPickBanInput } from '@/lib/mapSideStats';
import { isPlayedScore, tabCls, canonicalGauntletRankMap } from '@/lib/util';

type Tab = 'leaderboard' | 'schedule' | 'h2h' | 'stats';

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
type GauntletMode = { kind: 'gauntlet'; rounds: GauntletRound[] };

type SeasonTabViewProps = (RegularMode | GauntletMode) & {
  leaderboard: LeaderboardRowWithId[];
  seasonStatus: string;
  currentPlayerId: number | null;
  subStyle?: boolean;
  h2hData: H2HData;
};

export default function SeasonTabView(props: SeasonTabViewProps) {
  const { leaderboard, seasonStatus, currentPlayerId, subStyle, h2hData } = props;
  const isGauntlet = props.kind === 'gauntlet';
  const schedule = props.kind === 'regular' ? props.schedule : [];
  const rounds = props.kind === 'gauntlet' ? props.rounds : [];
  const seasonStartDate = props.kind === 'regular' ? props.seasonStartDate : null;

  const gauntletRanking = useMemo(
    () => (isGauntlet ? canonicalGauntletRankMap(rounds) : undefined),
    [isGauntlet, rounds],
  );

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

  const [tab, setTab] = useState<Tab>('leaderboard');
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'leaderboard', label: 'Leaderboard' },
    { key: 'stats', label: 'Stats' },
    { key: 'h2h', label: 'H2H' },
    { key: 'schedule', label: isGauntlet ? 'Rounds' : 'Schedule' },
  ];

  const tabBarButtons = tabs.map((t) => (
    <button
      key={t.key}
      onClick={() => setTab(t.key)}
      className={tabCls(tab === t.key, { compact: subStyle, accent: subStyle })}
    >
      {t.label}
    </button>
  ));

  const tabBar = subStyle ? (
    <div className="flex items-center justify-between mb-6">
      <div className="flex">{tabBarButtons}</div>
      <div className="flex items-center gap-3">{scheduleControls}</div>
    </div>
  ) : (
    <div className="flex items-center justify-between border-b border-[var(--color-border-primary)] mb-6">
      <div className="flex">{tabBarButtons}</div>
      <div className="flex items-center gap-3 pb-px">{scheduleControls}</div>
    </div>
  );

  return (
    <>
      {tabBar}

      {tab === 'leaderboard' && (
        <>
          {isGauntlet && <GauntletStandings rounds={rounds} leaderboard={leaderboard} />}
          {leaderboard.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No leaderboard data yet.
            </div>
          ) : (
            <LeaderboardTable
              rows={leaderboard}
              showMedals={seasonStatus === 'ARCHIVED'}
              playoffZones={!isGauntlet && seasonStatus === 'ACTIVE' ? { top: 2, bottom: 4 } : undefined}
              canonicalRanking={gauntletRanking}
            />
          )}
        </>
      )}

      {tab === 'schedule' && (
        isGauntlet ? (
          rounds.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No rounds recorded.
            </div>
          ) : (
            <GauntletRoundsList
              displayRounds={displayRounds}
              allRounds={rounds}
              openRounds={openItems}
              onToggleRound={toggleItem}
              currentPlayerId={currentPlayerId}
            />
          )
        ) : (
          schedule.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No weeks scheduled.
            </div>
          ) : (
            <ScheduleList
              displaySchedule={displaySchedule}
              openWeeks={openItems}
              onToggleWeek={toggleItem}
              seasonStartDate={seasonStartDate}
              currentPlayerId={currentPlayerId}
            />
          )
        )
      )}

      {tab === 'stats' && (
        leaderboard.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No stats available yet.
          </div>
        ) : (
          <AdvancedStatsView rows={leaderboard} matches={allMatches} />
        )
      )}

      {tab === 'h2h' && <H2HSection data={h2hData} />}
    </>
  );
}
