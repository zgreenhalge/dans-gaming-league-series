/**
 * The scrim night page's per-viewer rules: which match the lobby holds and which wait, who may act,
 * and which tabs show in what order.
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

test('no lobby before anyone checks in — only a signed-in viewer\'s own Check in', () => {
  const empty = night({ signups: [scrimSignup(1, 'definite')] });
  assert.equal(buildScrimNightPageModel(empty, PLAYER(1)).hasLobby, false);
  assert.equal(buildScrimNightPageModel(empty, PLAYER(1)).showCheckInOnly, true);
  assert.equal(buildScrimNightPageModel(empty, SIGNED_OUT).showCheckInOnly, false);
  assert.equal(buildScrimNightPageModel(night(), PLAYER(1)).hasLobby, true);
  assert.equal(buildScrimNightPageModel(night({ checkInOpen: false }), PLAYER(1)).showCheckInOnly, false);
});

test('tabs: a lobby leads with the standings under it; an ended night leads with Leaderboard', () => {
  const order = (n: ScrimNightView, advanced = false) => scrimNightTabOrder(n, buildScrimNightPageModel(n, PLAYER(1)), advanced);
  assert.deepEqual(order(night()), ['lobby', 'matches']);
  assert.deepEqual(order(night({ leaderboard: standings }), true), ['lobby', 'matches', 'stats', 'advanced']);
  const ended = night({ current: false, checkInOpen: false, leaderboard: standings, h2h: { ...NO_H2H, duos: [{} as H2HData['duos'][number]] } });
  assert.deepEqual(order(ended), ['leaderboard', 'matches', 'stats', 'h2h']);
  assert.deepEqual(order(night({ checkInOpen: false })), ['matches', 'leaderboard']);
});

report();
