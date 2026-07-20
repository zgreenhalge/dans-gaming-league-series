/**
 * Unit tests for `parseConnectedPlayers` — derives the current roster from a window of raw
 * console/log lines (real formats captured live from the DGLS server: round-reset broadcasts,
 * purchases, disconnects, and the `STEAM_ID_PENDING` state a player passes through mid-team-switch).
 *
 * Run:  npx tsx src/lib/server-players.test.ts
 */

import assert from 'node:assert/strict';
import { parseConnectedPlayers, linesSinceMarker } from './server-players';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

test('parseConnectedPlayers: extracts current roster from round-reset lines, dropping SourceTV', () => {
  const lines = [
    'Jul 16 00:24:05:  "SourceTV<0><BOT><Unassigned>" OnPreResetRound => CTMDBG, team 0  will switch 0 1090.19 ',
    'Jul 16 00:24:05:  "kingfisher<1><[U:1:72471586]><Spectator>" OnPreResetRound => CTMDBG, team 1  will switch 0 1090.19 ',
    'Jul 16 00:24:05:  "SBarretta<2><[U:1:103369703]><TERRORIST>" OnPreResetRound => CTMDBG, team 2  will switch 0 1090.19 ',
  ];
  const players = parseConnectedPlayers(lines);
  assert.deepEqual(
    players.map((p) => p.name).sort(),
    ['SBarretta', 'kingfisher'],
  );
  assert.equal(players.find((p) => p.name === 'SBarretta')?.steamId, '[U:1:103369703]');
});

test('parseConnectedPlayers: a later disconnect removes the player', () => {
  const lines = [
    'Jul 16 00:24:05:  "SBarretta<2><[U:1:103369703]><TERRORIST>" purchased "smokegrenade"',
    'Jul 16 00:30:16:  L 07/16/2026 - 00:30:16: "SBarretta<2><[U:1:103369703]><TERRORIST>" disconnected (reason "NETWORK_DISCONNECT_DISCONNECT_BY_USER")',
  ];
  assert.deepEqual(parseConnectedPlayers(lines), []);
});

test('parseConnectedPlayers: STEAM_ID_PENDING keeps the last known real steamid', () => {
  const lines = [
    'Jul 16 00:24:05:  "Chief Seagulls<4><[U:1:1064778845]><CT>" purchased "m4a1_silencer"',
    'Jul 16 00:32:13:  L 07/16/2026 - 00:32:13: "Chief Seagulls<4><STEAM_ID_PENDING>" switched from team <CT> to <Unassigned>',
  ];
  const players = parseConnectedPlayers(lines);
  assert.equal(players.length, 1);
  assert.equal(players[0].steamId, '[U:1:1064778845]');
});

test('parseConnectedPlayers: userid reused after reconnect resolves to the latest occupant', () => {
  const lines = [
    'Jul 16 00:20:00:  "OldPlayer<2><[U:1:111]><TERRORIST>" purchased "ak47"',
    'Jul 16 00:25:00:  L 07/16/2026 - 00:25:00: "OldPlayer<2><[U:1:111]><TERRORIST>" disconnected (reason "NETWORK_DISCONNECT_DISCONNECT_BY_USER")',
    'Jul 16 00:26:00:  "NewPlayer<2><[U:1:222]><CT>" purchased "m4a1"',
  ];
  const players = parseConnectedPlayers(lines);
  assert.deepEqual(players, [{ name: 'NewPlayer', steamId: '[U:1:222]' }]);
});

test('parseConnectedPlayers: empty log yields no players', () => {
  assert.deepEqual(parseConnectedPlayers([]), []);
});

test('linesSinceMarker: drops everything at or before the last marker occurrence', () => {
  const lines = ['a', 'b', 'MARKER', 'c', 'd'];
  assert.deepEqual(linesSinceMarker(lines, 'MARKER'), ['c', 'd']);
});

test('linesSinceMarker: uses the LAST occurrence when the marker appears more than once', () => {
  const lines = ['MARKER', 'a', 'MARKER', 'b'];
  assert.deepEqual(linesSinceMarker(lines, 'MARKER'), ['b']);
});

test('linesSinceMarker: returns everything unchanged when the marker is not present', () => {
  const lines = ['a', 'b', 'c'];
  assert.deepEqual(linesSinceMarker(lines, 'MARKER'), lines);
});

test('linesSinceMarker + parseConnectedPlayers: a stale connect from a previous boot, with no', () => {
  // ...matching disconnect, is dropped once this boot's marker line is in the window — reproducing
  // the reused-server staleness bug (a phantom "connected" player from a prior session/boot).
  const lines = [
    'Jul 16 00:10:00:  "GhostFromLastSession<3><[U:1:999]><CT>" purchased "ak47"',
    'DGLS-SCRIM-BOOT',
  ];
  assert.deepEqual(parseConnectedPlayers(linesSinceMarker(lines, 'DGLS-SCRIM-BOOT')), []);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
