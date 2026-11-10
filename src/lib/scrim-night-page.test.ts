/**
 * The scrim night page's per-viewer rules: what the status bar shows, which match the lobby holds and
 * which wait, who may act, and which tabs show in what order.
 *
 * Run:  npx vitest run src/lib/scrim-night-page.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { buildScrimNightPageModel, scrimNightTabOrder } from './scrim-night-page';
import { scrimSignup } from './test-support/scrimFixtures';
import type { ScrimLeaderboardRow, ScrimMatch, ScrimNightView } from './queries';
import type { H2HData } from './h2h';

function match(id: number, final_score: string | null, server_state: string | null, players: [number, number, number, number] = [1, 2, 3, 4]): ScrimMatch {
  return {
    id,
    night_id: 5,
    match_number: id,
    map: 'cobble',
    workshop_id: null,
    side_choice: 'knife',
    skins_starting_side: null,
    shirts: [players[0], players[1]],
    skins: [players[2], players[3]],
    players: [],
    final_score,
    server_state,
  };
}

const NO_H2H: H2HData = { duos: [], rivals: [], players: [] };

function night(overrides: Partial<ScrimNightView> = {}): ScrimNightView {
  return {
    night: { id: 5, startsAt: '2026-01-01T20:00:00Z' },
    started: true,
    checkInOpen: true,
    current: true,
    signups: [1, 2, 3, 4].map((id) => scrimSignup(id, 'definite', { checked_in_at: '2026-01-01T19:45:00Z' })),
    matches: [],
    leaderboard: [],
    h2h: NO_H2H,
    ...overrides,
  };
}

const standings = [{ player_id: 1 } as ScrimLeaderboardRow];
const ADMIN = { playerId: 9, isAdmin: true };
const PLAYER = (id: number) => ({ playerId: id, isAdmin: false });
const SIGNED_OUT = { playerId: null, isAdmin: false };

test('the lobby holds the first match still needing the server; later ones queue; finished-but-unscored ones await a score', () => {
  const matches = [match(1, '13-9', 'done'), match(2, null, 'done'), match(3, null, 'live'), match(4, null, null, [5, 6, 7, 8])];
  const model = buildScrimNightPageModel(night({ matches }), PLAYER(1));
  assert.equal(model.lobbyMatch?.id, 3);
  assert.deepEqual(model.queued.map((q) => q.match.id), [4]);
  assert.deepEqual(model.awaitingScore.map((m) => m.id), [2]);
  assert.deepEqual(model.scoredMatchIds, [1]);
});

test('a queued match is discardable by its players or an admin, not by anyone else', () => {
  const matches = [match(1, null, 'live'), match(2, null, null, [1, 2, 3, 4])];
  assert.equal(buildScrimNightPageModel(night({ matches }), PLAYER(1)).queued[0].canDiscard, true);
  assert.equal(buildScrimNightPageModel(night({ matches }), ADMIN).queued[0].canDiscard, true);
  assert.equal(buildScrimNightPageModel(night({ matches }), PLAYER(7)).queued[0].canDiscard, false);
  assert.equal(buildScrimNightPageModel(night({ matches }), SIGNED_OUT).queued[0].canDiscard, false);
});

test('making matches: a checked-in player or an admin; Generate Rounds only with four in and no match waiting', () => {
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).canMake, true);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(7)).canMake, false);
  assert.equal(buildScrimNightPageModel(night(), ADMIN).canMake, true);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).offerRounds, true);
  assert.equal(buildScrimNightPageModel(night({ matches: [match(1, null, null)] }), PLAYER(1)).offerRounds, false);
  assert.equal(buildScrimNightPageModel(night({ signups: night().signups.slice(0, 3) }), PLAYER(1)).offerRounds, false);
  assert.equal(buildScrimNightPageModel(night({ checkInOpen: false }), ADMIN).offerRounds, false);
});

test('ending the night: once started, for anyone signed up or an admin', () => {
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).canEnd, true);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(7)).canEnd, false);
  assert.equal(buildScrimNightPageModel(night(), ADMIN).canEnd, true);
  assert.equal(buildScrimNightPageModel(night({ started: false }), ADMIN).canEnd, false);
});

test('the status bar: the night\'s state, and the checked-in count while check-in is open', () => {
  const state = (n: ScrimNightView) => buildScrimNightPageModel(n, SIGNED_OUT).status.state;
  assert.equal(state(night({ started: false })), 'upcoming');
  assert.equal(state(night()), 'live');
  assert.equal(state(night({ current: false, checkInOpen: false })), 'final');
  assert.equal(buildScrimNightPageModel(night(), SIGNED_OUT).status.checkedInCount, 4);
  assert.equal(buildScrimNightPageModel(night({ checkInOpen: false, started: false }), SIGNED_OUT).status.checkedInCount, null);
});

test('the status bar: league matches during a night that has not ended, soonest first', () => {
  const scheduled = [
    { id: 2, label: 'B', scheduledAt: '2026-01-01T22:00:00Z' },
    { id: 1, label: 'A', scheduledAt: '2026-01-01T20:30:00Z' },
    { id: 3, label: 'C', scheduledAt: '2026-01-03T20:00:00Z' },
  ];
  assert.deepEqual(buildScrimNightPageModel(night(), SIGNED_OUT, scheduled).status.leagueMatches.map((m) => m.id), [1, 2]);
  assert.deepEqual(buildScrimNightPageModel(night({ current: false }), SIGNED_OUT, scheduled).status.leagueMatches, []);
});

test('the status bar: the viewer\'s Check in while check-in is open, and their commitment until the night is over', () => {
  const signups = [scrimSignup(1, 'maybe'), scrimSignup(2, 'definite', { checked_in_at: '2026-01-01T19:45:00Z' })];
  assert.deepEqual(buildScrimNightPageModel(night({ signups }), PLAYER(1)).status.checkIn, { playerId: 1, checkedIn: false });
  assert.deepEqual(buildScrimNightPageModel(night({ signups }), PLAYER(2)).status.checkIn, { playerId: 2, checkedIn: true });
  assert.deepEqual(buildScrimNightPageModel(night({ signups }), PLAYER(7)).status.checkIn, { playerId: 7, checkedIn: false }, 'checking in signs a player up');
  assert.equal(buildScrimNightPageModel(night({ signups, checkInOpen: false, started: false }), PLAYER(1)).status.checkIn, null, 'before check-in opens');
  assert.equal(buildScrimNightPageModel(night({ signups }), SIGNED_OUT).status.checkIn, null);

  assert.deepEqual(buildScrimNightPageModel(night({ signups, checkInOpen: false, started: false }), PLAYER(1)).status.commitment, { playerId: 1, commitment: 'maybe' });
  assert.deepEqual(buildScrimNightPageModel(night({ signups }), PLAYER(7)).status.commitment, { playerId: 7, commitment: null });
  assert.equal(buildScrimNightPageModel(night({ signups, current: false, checkInOpen: false }), PLAYER(1)).status.commitment, null);
  assert.equal(buildScrimNightPageModel(night({ signups }), SIGNED_OUT).status.commitment, null);
});

test('the roster\'s admin menus: an admin, until the night is over', () => {
  assert.equal(buildScrimNightPageModel(night(), ADMIN).rosterAdmin, true);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).rosterAdmin, false);
  assert.equal(buildScrimNightPageModel(night({ current: false, checkInOpen: false }), ADMIN).rosterAdmin, false);
});

test('no lobby before anyone checks in', () => {
  assert.equal(buildScrimNightPageModel(night({ signups: [scrimSignup(1, 'definite')] }), PLAYER(1)).hasLobby, false);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).hasLobby, true);
  assert.equal(buildScrimNightPageModel(night({ checkInOpen: false }), PLAYER(1)).hasLobby, false);
});

test('tabs: only those with something to show — an upcoming night with signups has only Roster', () => {
  const order = (n: ScrimNightView, advanced = false) => scrimNightTabOrder(n, buildScrimNightPageModel(n, PLAYER(1)), advanced);
  assert.deepEqual(order(night({ checkInOpen: false, started: false })), ['roster']);
  assert.deepEqual(order(night({ checkInOpen: false, started: false, signups: [] })), [], 'no signups, nothing played');
  assert.deepEqual(order(night({ current: false, checkInOpen: false, signups: [] })), [], 'an ended night with no signups or matches');
  assert.deepEqual(order(night({ current: false, checkInOpen: false })), ['roster'], 'an ended night with signups and no matches');
  assert.deepEqual(order(night()), ['lobby', 'roster'], 'a lobby with no match started yet');
  assert.deepEqual(order(night({ signups: [scrimSignup(1, 'definite')] })), ['roster'], 'check-in open, nobody checked in');
  assert.deepEqual(order(night({ matches: [match(1, null, null)] })), ['lobby', 'roster'], 'an unstarted lobby match is not listed');
  assert.deepEqual(order(night({ matches: [match(1, null, 'live')] })), ['lobby', 'roster', 'matches']);
});

test('tabs: a lobby leads with the standings under it; an ended night leads with Leaderboard', () => {
  const order = (n: ScrimNightView, advanced = false) => scrimNightTabOrder(n, buildScrimNightPageModel(n, PLAYER(1)), advanced);
  const played = [match(1, '13-9', 'done')];
  assert.deepEqual(order(night({ matches: played, leaderboard: standings }), true), ['lobby', 'roster', 'matches', 'stats', 'advanced']);
  const ended = night({ current: false, checkInOpen: false, matches: played, leaderboard: standings, h2h: { ...NO_H2H, duos: [{} as H2HData['duos'][number]] } });
  assert.deepEqual(order(ended), ['leaderboard', 'matches', 'stats', 'h2h', 'roster'], 'Roster goes last once the night is over');
  assert.deepEqual(order(night({ checkInOpen: false, matches: played, leaderboard: standings })), ['roster', 'matches', 'leaderboard', 'stats'], 'a running night with nobody checked in');
});

report();
