/**
 * The scrim night page's per-viewer rules: what the status bar shows, which match the lobby holds and
 * which wait, the night's running order, who may act, and which tabs show in what order.
 *
 * Run:  npx vitest run src/lib/scrim-night-page.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { buildScrimNightPageModel, scrimNightTabOrder, type ScrimNightViewer } from './scrim-night-page';
import { scrimSignup } from './test-support/scrimFixtures';
import type { ScrimLeaderboardRow, ScrimMatch, ScrimNightView } from './queries';
import type { H2HData } from './h2h';
import type { ScheduledMatchRef } from './server-schedule-collision';

function match(id: number, final_score: string | null, server_state: string | null, players: [number, number, number, number] = [1, 2, 3, 4]): ScrimMatch {
  return {
    id,
    night_id: 5,
    revision: 0,
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
    reopenable: false,
    signups: [1, 2, 3, 4].map((id) => scrimSignup(id, 'definite', { checked_in_at: '2026-01-01T19:45:00Z' })),
    matches: [],
    leaderboard: [],
    h2h: NO_H2H,
    ...overrides,
  };
}

/** Half an hour into the fixture night (it starts 20:00; it goes idle after an hour). */
const NOW = new Date('2026-01-01T20:30:00Z');
const NOT_STARTED = { id: 5, startsAt: '2026-01-01T21:00:00Z' };
const build = (n: ScrimNightView, viewer: ScrimNightViewer, scheduled: ScheduledMatchRef[] = []) => buildScrimNightPageModel(n, viewer, NOW, scheduled);

const standings =[{ player_id: 1 } as ScrimLeaderboardRow];
const ADMIN = { playerId: 9, isAdmin: true };
const PLAYER = (id: number) => ({ playerId: id, isAdmin: false });
const SIGNED_OUT = { playerId: null, isAdmin: false };

test('the lobby holds the first match still needing the server; later ones queue', () => {
  const matches = [match(1, '13-9', 'done'), match(2, null, 'done'), match(3, null, 'live'), match(4, null, null, [5, 6, 7, 8])];
  const model = build(night({ matches }), PLAYER(1));
  assert.equal(model.lobbyMatch?.id, 3);
  assert.deepEqual(model.queued.map((q) => q.match.id), [4]);
  assert.deepEqual(model.scoredMatchIds, [1]);
});

test('the running order: played and pending in play order, then live, then up next', () => {
  const matches = [match(1, '13-9', 'done'), match(2, null, 'done'), match(3, null, 'live'), match(4, null, null)];
  const order = build(night({ matches }), PLAYER(1)).runningOrder;
  assert.deepEqual(order.map((e) => [e.match.id, e.status]), [[1, 'played'], [2, 'pending'], [3, 'live'], [4, 'next']]);
});

test('the running order: a match that finished while an earlier one waits for the server comes first', () => {
  const matches = [match(1, null, 'failed'), match(2, '13-9', 'done')];
  const order = build(night({ matches }), PLAYER(1)).runningOrder;
  assert.deepEqual(order.map((e) => [e.match.id, e.status]), [[2, 'played'], [1, 'next']]);
});

test('a match already made stays startable once the night is over: the lobby holds it and the running order keeps it', () => {
  const matches = [match(1, '13-9', 'done'), match(2, null, null)];
  const model = build(night({ matches, current: false, checkInOpen: false }), ADMIN);
  assert.deepEqual(model.runningOrder.map((e) => [e.match.id, e.status]), [[1, 'played'], [2, 'next']]);
  assert.equal(model.lobbyMatch?.id, 2);
  assert.equal(model.hasLobby, true);
  assert.equal(model.canEnd, false);
});

test('reopening: a night that is over and reopenable, for anyone signed up or an admin', () => {
  const over = night({ current: false, checkInOpen: false, reopenable: true });
  assert.equal(build(over, PLAYER(1)).status.canReopen, true);
  assert.equal(build(over, ADMIN).status.canReopen, true);
  assert.equal(build(over, PLAYER(7)).status.canReopen, false);
  assert.equal(build(over, SIGNED_OUT).status.canReopen, false);
  assert.equal(build(night({ current: false, checkInOpen: false }), ADMIN).status.canReopen, false, 'past the span');
});

test('the running order: an admin resolves each pending row, and only those', () => {
  const matches = [match(1, '13-9', 'done'), match(2, null, 'done'), match(3, null, null)];
  const resolve = (viewer: { playerId: number | null; isAdmin: boolean }) =>
    build(night({ matches }), viewer).runningOrder.map((e) => e.resolve);
  assert.deepEqual(resolve(ADMIN), [false, true, false]);
  assert.deepEqual(resolve(PLAYER(1)), [false, false, false]);
});

test('a queued match is discardable by its players or an admin, not by anyone else', () => {
  const matches = [match(1, null, 'live'), match(2, null, null, [1, 2, 3, 4])];
  assert.equal(build(night({ matches }), PLAYER(1)).queued[0].canDiscard, true);
  assert.equal(build(night({ matches }), ADMIN).queued[0].canDiscard, true);
  assert.equal(build(night({ matches }), PLAYER(7)).queued[0].canDiscard, false);
  assert.equal(build(night({ matches }), SIGNED_OUT).queued[0].canDiscard, false);
});

test('the lobby match is managed by its players or an admin, not by anyone else', () => {
  const canManageLobby = (viewer: ScrimNightViewer, matches = [match(1, null, null, [1, 2, 3, 4])]) =>
    build(night({ matches }), viewer).canManageLobby;
  assert.equal(canManageLobby(PLAYER(2)), true);
  assert.equal(canManageLobby(ADMIN), true);
  assert.equal(canManageLobby(PLAYER(7)), false);
  assert.equal(canManageLobby(SIGNED_OUT), false);
  assert.equal(canManageLobby(ADMIN, []), false, 'no lobby match');
});

test('making matches: a checked-in player or an admin; Generate Rounds only with four in and no match waiting', () => {
  assert.equal(build(night(), PLAYER(1)).canMake, true);
  assert.equal(build(night(), PLAYER(7)).canMake, false);
  assert.equal(build(night(), ADMIN).canMake, true);
  assert.equal(build(night(), PLAYER(1)).offerRounds, true);
  assert.equal(build(night({ matches: [match(1, null, null)] }), PLAYER(1)).offerRounds, false);
  assert.equal(build(night({ signups: night().signups.slice(0, 3) }), PLAYER(1)).offerRounds, false);
  assert.equal(build(night({ checkInOpen: false }), ADMIN).offerRounds, false);
});

test('ending the night: while it runs with no match waiting for the server, for anyone signed up or an admin', () => {
  assert.equal(build(night(), PLAYER(1)).canEnd, true);
  assert.equal(build(night({ matches: [match(1, null, 'live')] }), ADMIN).canEnd, false, 'a match holds the server');
  assert.equal(build(night({ matches: [match(1, null, null)] }), ADMIN).canEnd, false, 'a match waits to start');
  assert.equal(build(night({ matches: [match(1, null, 'done')] }), ADMIN).canEnd, true, 'a finished game awaiting its score');
  assert.equal(build(night(), PLAYER(7)).canEnd, false);
  assert.equal(build(night(), ADMIN).canEnd, true);
  assert.equal(build(night({ started: false, night: NOT_STARTED }), ADMIN).canEnd, false, 'before it starts');
  assert.equal(build(night({ current: false, checkInOpen: false, night: { id: 5, startsAt: '2026-01-01T20:00:00Z', endedAt: '2026-01-01T20:10:00Z' } }), ADMIN).canEnd, false, 'once it is over');
});

test('the status bar: the night\'s state, and the checked-in count while check-in is open', () => {
  const state = (n: ScrimNightView) => build(n, SIGNED_OUT).status.state;
  assert.equal(state(night({ started: false })), 'upcoming');
  assert.equal(state(night()), 'live');
  assert.equal(state(night({ current: false, checkInOpen: false })), 'final');
  assert.equal(build(night(), SIGNED_OUT).status.checkedInCount, 4);
  assert.equal(build(night({ checkInOpen: false, started: false }), SIGNED_OUT).status.checkedInCount, null);
});

test('the status bar: league matches during a night that has not ended, soonest first', () => {
  const scheduled = [
    { id: 2, label: 'B', scheduledAt: '2026-01-01T22:00:00Z' },
    { id: 1, label: 'A', scheduledAt: '2026-01-01T20:30:00Z' },
    { id: 3, label: 'C', scheduledAt: '2026-01-03T20:00:00Z' },
  ];
  assert.deepEqual(build(night(), SIGNED_OUT, scheduled).status.leagueMatches.map((m) => m.id), [1, 2]);
  assert.deepEqual(build(night({ current: false }), SIGNED_OUT, scheduled).status.leagueMatches, []);
});

test('the status bar: the viewer\'s Check in while check-in is open, and their commitment until the night is over', () => {
  const signups = [scrimSignup(1, 'maybe'), scrimSignup(2, 'definite', { checked_in_at: '2026-01-01T19:45:00Z' })];
  assert.deepEqual(build(night({ signups }), PLAYER(1)).status.checkIn, { playerId: 1, checkedIn: false });
  assert.deepEqual(build(night({ signups }), PLAYER(2)).status.checkIn, { playerId: 2, checkedIn: true });
  assert.deepEqual(build(night({ signups }), PLAYER(7)).status.checkIn, { playerId: 7, checkedIn: false }, 'checking in signs a player up');
  assert.equal(build(night({ signups, checkInOpen: false, started: false }), PLAYER(1)).status.checkIn, null, 'before check-in opens');
  assert.equal(build(night({ signups }), SIGNED_OUT).status.checkIn, null);

  assert.deepEqual(build(night({ signups, checkInOpen: false, started: false }), PLAYER(1)).status.commitment, { playerId: 1, commitment: 'maybe' });
  assert.deepEqual(build(night({ signups }), PLAYER(7)).status.commitment, { playerId: 7, commitment: null });
  assert.equal(build(night({ signups, current: false, checkInOpen: false }), PLAYER(1)).status.commitment, null);
  assert.equal(build(night({ signups }), SIGNED_OUT).status.commitment, null);
});

test('the roster\'s admin menus: an admin, until the night is over', () => {
  assert.equal(build(night(), ADMIN).rosterAdmin, true);
  assert.equal(build(night(), PLAYER(1)).rosterAdmin, false);
  assert.equal(build(night({ current: false, checkInOpen: false }), ADMIN).rosterAdmin, false);
});

test('no lobby before anyone checks in, unless the viewer may end the night', () => {
  const nobodyIn = night({ signups: [scrimSignup(1, 'definite')] });
  assert.equal(build(nobodyIn, PLAYER(7)).hasLobby, false);
  assert.equal(build(nobodyIn, PLAYER(1)).hasLobby, true, 'signed up: End night is in the lobby');
  assert.equal(build({ ...nobodyIn, started: false, night: NOT_STARTED }, PLAYER(1)).hasLobby, false, 'not started: nothing to end');
  assert.equal(build(night(), PLAYER(1)).hasLobby, true);
  assert.equal(build(night({ checkInOpen: false }), PLAYER(1)).hasLobby, false);
});

test('tabs: only those with something to show — an upcoming night with signups has only Roster', () => {
  const order = (n: ScrimNightView, advanced = false) => scrimNightTabOrder(n, build(n, PLAYER(1)), advanced);
  assert.deepEqual(order(night({ checkInOpen: false, started: false })), ['roster']);
  assert.deepEqual(order(night({ checkInOpen: false, started: false, signups: [] })), [], 'no signups, nothing played');
  assert.deepEqual(order(night({ current: false, checkInOpen: false, signups: [] })), [], 'an ended night with no signups or matches');
  assert.deepEqual(order(night({ current: false, checkInOpen: false })), ['roster'], 'an ended night with signups and no matches');
  assert.deepEqual(order(night()), ['lobby', 'roster'], 'a lobby with no match started yet');
  assert.deepEqual(order(night({ signups: [scrimSignup(1, 'definite')], started: false, night: NOT_STARTED })), ['roster'], 'check-in open, nobody checked in');
  assert.deepEqual(order(night({ matches: [match(1, null, null)] })), ['lobby', 'roster', 'matches'], 'a match waiting to start is up next');
  assert.deepEqual(order(night({ matches: [match(1, null, 'live')] })), ['lobby', 'roster', 'matches']);
});

test('tabs: a lobby leads, with Leaderboard after Matches; an ended night leads with Leaderboard', () => {
  const order = (n: ScrimNightView, advanced = false) => scrimNightTabOrder(n, build(n, PLAYER(1)), advanced);
  const played = [match(1, '13-9', 'done')];
  assert.deepEqual(order(night({ matches: played, leaderboard: standings }), true), ['lobby', 'roster', 'matches', 'leaderboard', 'stats', 'advanced']);
  const ended = night({ current: false, checkInOpen: false, matches: played, leaderboard: standings, h2h: { ...NO_H2H, duos: [{} as H2HData['duos'][number]] } });
  assert.deepEqual(order(ended), ['leaderboard', 'matches', 'stats', 'h2h', 'roster'], 'Roster goes last with no lobby');
  assert.deepEqual(order(night({ checkInOpen: false, matches: played, leaderboard: standings })), ['matches', 'leaderboard', 'stats', 'roster'], 'a running night with nobody checked in: results first');
});

report();
