// What a scrim night's page (`/scrims/[id]`) shows for one viewer: which match the lobby holds, which
// wait behind it, who may act, and which tabs the page has, in order. Pure — the page fetches the
// night and renders what this returns, so the rules are testable without rendering anything.

import type { ScrimMatch, ScrimNightView } from './queries';
import { scrimMatchNeedsServer } from './scrim-matches';
import { SCRIM_MATCH_SIZE } from './scrim-schedule';
import { isPlayedScore } from './util';

export const SCRIM_NIGHT_TABS = ['lobby', 'matches', 'leaderboard', 'stats', 'advanced', 'h2h'] as const;
export type ScrimNightTab = (typeof SCRIM_NIGHT_TABS)[number];

/** The signed-in viewer (`playerId` `null` when signed out) and whether they're an admin. */
export interface ScrimNightViewer {
  playerId: number | null;
  isAdmin: boolean;
}

export interface ScrimNightPageModel {
  /** Checked-in players: the pool a match draws from. */
  pool: { id: number; name: string }[];
  /** The first match that still needs the server (`scrimMatchNeedsServer()`): the lobby's. */
  lobbyMatch: ScrimMatch | null;
  /** The matches waiting behind it, in play order, and whether the viewer may discard each. */
  queued: { match: ScrimMatch; canDiscard: boolean }[];
  /** Games over with no score — the demo is parsing, or the server stopped early. */
  awaitingScore: ScrimMatch[];
  scoredMatchIds: number[];
  viewerCheckedIn: boolean;
  /** The viewer may make the next match: checked in, or an admin. */
  canMake: boolean;
  /** The viewer may end the night: it has started, and they're signed up or an admin. */
  canEnd: boolean;
  /** Generate Rounds is offered where Next Match is: check-in open, no match waiting, four checked in. */
  offerRounds: boolean;
  /** The lobby exists while check-in is open and someone has checked in or a match is waiting. */
  hasLobby: boolean;
  /** Before the lobby exists, a signed-in viewer still gets their own Check in: their id, else `null`. */
  checkInOnlyFor: number | null;
}

export function buildScrimNightPageModel(night: ScrimNightView, viewer: ScrimNightViewer): ScrimNightPageModel {
  const { playerId, isAdmin } = viewer;
  const pool = night.signups.filter((s) => s.checked_in_at).map((s) => ({ id: s.player_id, name: s.player_name }));
  // Matches play in order: the first still needing the server is the lobby's, the rest wait behind it.
  const [lobbyMatch = null, ...waiting] = night.matches.filter(scrimMatchNeedsServer);
  const inMatch = (m: ScrimMatch) => playerId != null && [...m.shirts, ...m.skins].includes(playerId);
  const viewerCheckedIn = playerId != null && pool.some((p) => p.id === playerId);
  const canMake = isAdmin || viewerCheckedIn;
  const hasLobby = night.checkInOpen && (pool.length > 0 || lobbyMatch != null);
  return {
    pool,
    lobbyMatch,
    queued: waiting.map((m) => ({ match: m, canDiscard: isAdmin || inMatch(m) })),
    awaitingScore: night.matches.filter((m) => !isPlayedScore(m.final_score) && !scrimMatchNeedsServer(m)),
    scoredMatchIds: night.matches.filter((m) => isPlayedScore(m.final_score)).map((m) => m.id),
    viewerCheckedIn,
    canMake,
    canEnd: night.started && (isAdmin || night.signups.some((s) => s.player_id === playerId)),
    offerRounds: night.checkInOpen && canMake && lobbyMatch == null && pool.length >= SCRIM_MATCH_SIZE,
    hasLobby,
    checkInOnlyFor: night.checkInOpen && !hasLobby ? playerId : null,
  };
}

/** The page's tabs in display order — only those with something to show; the page opens on the first.
 *  With a lobby, the standings sit under it condensed rather than in a tab of their own; once the night
 *  is over (and there's no lobby), the standings are the headline, so they lead. */
export function scrimNightTabOrder(night: ScrimNightView, model: ScrimNightPageModel, hasAdvancedStats: boolean): ScrimNightTab[] {
  const hasStandings = night.leaderboard.length > 0;
  const leaderboardFirst = !night.current && !model.hasLobby && hasStandings;
  const tabs: ScrimNightTab[] = [];
  if (model.hasLobby) tabs.push('lobby');
  if (leaderboardFirst) tabs.push('leaderboard');
  tabs.push('matches');
  if (!model.hasLobby && !leaderboardFirst) tabs.push('leaderboard');
  if (hasStandings) tabs.push('stats');
  if (hasAdvancedStats) tabs.push('advanced');
  if (night.h2h.duos.length > 0 || night.h2h.rivals.length > 0) tabs.push('h2h');
  return tabs;
}

/** What a night's Stats and Advanced Stats tabs show depends on: its scored matches and their scores,
 *  and whether any has parsed sabremetrics. `ScrimNightStats` reuses a fetch only while this holds. */
export function scrimNightStatsVersion(matches: ScrimMatch[], hasAdvancedStats: boolean): string {
  const scored = matches.filter((m) => isPlayedScore(m.final_score)).map((m) => `${m.id}:${m.final_score}`);
  return `${scored.join(',')}|${hasAdvancedStats ? 'advanced' : 'basic'}`;
}
