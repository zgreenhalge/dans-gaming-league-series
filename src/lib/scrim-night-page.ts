// What a scrim night's page (`/scrims/[id]`) shows for one viewer: the status bar over every tab, which
// match the lobby holds, which wait behind it, who may act, and which tabs the page has, in order.
// Pure — the page fetches the night and renders what this returns, so the rules are testable without
// rendering anything.

import type { ScrimMatch, ScrimNightView } from './queries';
import { isScrimMatchListed, scrimMatchNeedsServer } from './scrim-matches';
import { SCRIM_MATCH_SIZE, leagueMatchesDuring, type ScrimCommitment } from './scrim-schedule';
import type { ScheduledMatchRef } from './server-schedule-collision';
import { isPlayedScore } from './util';

export const SCRIM_NIGHT_TABS = ['lobby', 'roster', 'matches', 'leaderboard', 'stats', 'advanced', 'h2h'] as const;
export type ScrimNightTab = (typeof SCRIM_NIGHT_TABS)[number];

/** Where the night is: not started, running, or over (`hasScrimNightEnded()`, read through the view's
 *  `current`). */
export type ScrimNightState = 'upcoming' | 'live' | 'final';

/** The signed-in viewer (`playerId` `null` when signed out) and whether they're an admin. */
export interface ScrimNightViewer {
  playerId: number | null;
  isAdmin: boolean;
}

/** What the night's status bar (`ScrimNightStatusBar`) shows, the same over every tab. */
export interface ScrimNightStatus {
  state: ScrimNightState;
  /** How many have checked in, while check-in is open; `null` otherwise. */
  checkedInCount: number | null;
  /** League matches scheduled during a night that hasn't ended (`leagueMatchesDuring()`). */
  leagueMatches: ScheduledMatchRef[];
  /** The viewer's own Check in / Check out: signed in, with check-in open; `null` otherwise. */
  checkIn: { playerId: number; checkedIn: boolean } | null;
  /** The viewer's own commitment, `null` before they sign up: signed in, with the night not over (signups
   *  close when it ends); `null` otherwise. */
  commitment: { playerId: number; commitment: ScrimCommitment | null } | null;
}

export interface ScrimNightPageModel {
  status: ScrimNightStatus;
  /** The roster's admin menus: an admin, with the night not over. */
  rosterAdmin: boolean;
  /** Checked-in players: the pool a match draws from. */
  pool: { id: number; name: string }[];
  /** The first match that still needs the server (`scrimMatchNeedsServer()`): the lobby's. */
  lobbyMatch: ScrimMatch | null;
  /** The matches waiting behind it, in play order, and whether the viewer may discard each. */
  queued: { match: ScrimMatch; canDiscard: boolean }[];
  /** Games over with no score — the demo is parsing, or the server stopped early. */
  awaitingScore: ScrimMatch[];
  scoredMatchIds: number[];
  /** The viewer may make the next match: checked in, or an admin. */
  canMake: boolean;
  /** The viewer may end the night: it has started, and they're signed up or an admin. */
  canEnd: boolean;
  /** Generate Rounds is offered where Next Match is: check-in open, no match waiting, four checked in. */
  offerRounds: boolean;
  /** The lobby exists while check-in is open and someone has checked in or a match is waiting. */
  hasLobby: boolean;
}

/** `scheduled` is the league's scheduled, unplayed matches (`getScheduledUnplayedMatches()`). */
export function buildScrimNightPageModel(night: ScrimNightView, viewer: ScrimNightViewer, scheduled: ScheduledMatchRef[] = []): ScrimNightPageModel {
  const { playerId, isAdmin } = viewer;
  const pool = night.signups.filter((s) => s.checked_in_at).map((s) => ({ id: s.player_id, name: s.player_name }));
  // Matches play in order: the first still needing the server is the lobby's, the rest wait behind it.
  const [lobbyMatch = null, ...waiting] = night.matches.filter(scrimMatchNeedsServer);
  const inMatch = (m: ScrimMatch) => playerId != null && [...m.shirts, ...m.skins].includes(playerId);
  const viewerCheckedIn = playerId != null && pool.some((p) => p.id === playerId);
  const canMake = isAdmin || viewerCheckedIn;
  const hasLobby = night.checkInOpen && (pool.length > 0 || lobbyMatch != null);
  const mine = night.signups.find((s) => s.player_id === playerId);
  return {
    status: {
      state: !night.current ? 'final' : night.started ? 'live' : 'upcoming',
      checkedInCount: night.checkInOpen ? pool.length : null,
      leagueMatches: night.current ? leagueMatchesDuring(night.night, scheduled) : [],
      checkIn: playerId != null && night.checkInOpen ? { playerId, checkedIn: viewerCheckedIn } : null,
      commitment: playerId != null && night.current ? { playerId, commitment: mine?.commitment ?? null } : null,
    },
    rosterAdmin: isAdmin && night.current,
    pool,
    lobbyMatch,
    queued: waiting.map((m) => ({ match: m, canDiscard: isAdmin || inMatch(m) })),
    awaitingScore: night.matches.filter((m) => !isPlayedScore(m.final_score) && !scrimMatchNeedsServer(m)),
    scoredMatchIds: night.matches.filter((m) => isPlayedScore(m.final_score)).map((m) => m.id),
    canMake,
    canEnd: night.started && (isAdmin || night.signups.some((s) => s.player_id === playerId)),
    offerRounds: night.checkInOpen && canMake && lobbyMatch == null && pool.length >= SCRIM_MATCH_SIZE,
    hasLobby,
  };
}

/** The page's tabs in display order — only those with something to show (`docs/patterns.md`, "Gate a
 *  tab on data"), so a night with no signups and nothing played has none; the page opens on the first.
 *  Roster shows once anyone has signed up, Matches once a match has started (`isScrimMatchListed()`),
 *  Leaderboard once there are standings. With a lobby, the standings sit under it condensed rather than
 *  in a tab of their own; once the night is over (and there's no lobby), they are the headline, so they
 *  lead. Roster follows the Lobby while the night is on and goes last once it's over, when the results
 *  come first. */
export function scrimNightTabOrder(night: ScrimNightView, model: ScrimNightPageModel, hasAdvancedStats: boolean): ScrimNightTab[] {
  const hasStandings = night.leaderboard.length > 0;
  const leaderboardFirst = !night.current && !model.hasLobby && hasStandings;
  const hasRoster = night.signups.length > 0;
  const tabs: ScrimNightTab[] = [];
  if (model.hasLobby) tabs.push('lobby');
  if (hasRoster && night.current) tabs.push('roster');
  if (leaderboardFirst) tabs.push('leaderboard');
  if (night.matches.some(isScrimMatchListed)) tabs.push('matches');
  if (hasStandings && !model.hasLobby && !leaderboardFirst) tabs.push('leaderboard');
  if (hasStandings) tabs.push('stats');
  if (hasAdvancedStats) tabs.push('advanced');
  if (night.h2h.duos.length > 0 || night.h2h.rivals.length > 0) tabs.push('h2h');
  if (hasRoster && !night.current) tabs.push('roster');
  return tabs;
}

