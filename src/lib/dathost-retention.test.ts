/**
 * Unit tests for dathost-retention.ts (#163) — groupByMatchId, daysAgo, parseModifiedAt, and
 * residueAgeDays, the pure file-naming and age-math logic behind scripts/dathost-cleanup.ts. The
 * script's own IO (DatHost file listing, R2 HEAD checks, Supabase reads) stays integration-only.
 *
 * Run:  npx tsx src/lib/dathost-retention.test.ts
 */

import assert from 'node:assert/strict';
import { groupByMatchId, daysAgo, parseModifiedAt, residueAgeDays, type RemoteFile } from './dathost-retention';
import { test, report } from './test-support/miniTest';

function file(path: string, size = 0, modifiedAt: Date | null = null): RemoteFile {
  return { path, size, modifiedAt };
}

// --- groupByMatchId ---

test('groupByMatchId: matches each known MatchZy path pattern', () => {
  const files = [
    file('matchzy_501_1_round3.txt'),
    file('MatchZyDataBackup/matchzy_501_1_round4.json'),
    file('MatchZy_Stats/501/stats.csv'),
    file('MatchZyPlayerNames/Match_501.ini'),
    file('MatchZy/2026-07-20_18-30-00_501_de_such.dem'),
  ];
  const byMatch = groupByMatchId(files);
  assert.equal(byMatch.size, 1);
  assert.equal(byMatch.get(501)?.length, 5);
});

test('groupByMatchId: matches demoBaseName()\'s current naming (date_matchId_map, no time)', () => {
  const byMatch = groupByMatchId([file('MatchZy/2026-08-06_59_memento.dem')]);
  assert.deepEqual([...byMatch.keys()], [59]);
});

test('groupByMatchId: matches demoBaseName()\'s "unscheduled" date placeholder', () => {
  const byMatch = groupByMatchId([file('MatchZy/unscheduled_501_de-such.dem')]);
  assert.deepEqual([...byMatch.keys()], [501]);
});

test('groupByMatchId: matches a bare {matchId}.dem demo', () => {
  const byMatch = groupByMatchId([file('MatchZy/54.dem')]);
  assert.deepEqual([...byMatch.keys()], [54]);
});

test('groupByMatchId: different match ids land in separate buckets', () => {
  const files = [file('matchzy_501_1_round1.txt'), file('matchzy_502_1_round1.txt')];
  const byMatch = groupByMatchId(files);
  assert.deepEqual([...byMatch.keys()].sort(), [501, 502]);
  assert.equal(byMatch.get(501)?.length, 1);
  assert.equal(byMatch.get(502)?.length, 1);
});

test('groupByMatchId: a path matching no pattern is dropped, not grouped under some fallback key', () => {
  const files = [file('matchzy_501_1_round1.txt'), file('some_unrelated_recreational_file.txt')];
  const byMatch = groupByMatchId(files);
  assert.equal(byMatch.size, 1);
  assert.equal([...byMatch.values()].flat().length, 1);
});

test('groupByMatchId: a file only matches its first applicable pattern, never double-counted', () => {
  // MatchZy_Stats/<id>/ is a prefix match — confirm a stats file isn't also picked up by an
  // unrelated pattern and pushed into the bucket twice.
  const files = [file('MatchZy_Stats/501/players.csv')];
  const byMatch = groupByMatchId(files);
  assert.equal(byMatch.get(501)?.length, 1);
});

test('groupByMatchId: empty input returns an empty map', () => {
  assert.equal(groupByMatchId([]).size, 0);
});

test('groupByMatchId: all three demo naming schemes resolve independently when mixed in one call — no matcher shadows another', () => {
  // One demo per scheme, each a different match id: current demoBaseName() format, the legacy
  // DatHost-auto format (with an HH-MM-SS segment demoBaseName() never produces), and the even
  // older bare {matchId}.dem. If matcher precedence in groupByMatchId() ever regressed (e.g. a
  // future matcher inserted ahead of these three), one of these would resolve to the wrong id or
  // to `null` instead.
  const files = [
    file('MatchZy/2026-08-06_59_memento.dem'), // current
    file('MatchZy/2026-07-20_18-30-00_501_de_such.dem'), // legacy DatHost-auto
    file('MatchZy/54.dem'), // legacy bare id
  ];
  const byMatch = groupByMatchId(files);
  assert.deepEqual([...byMatch.keys()].sort((a, b) => a - b), [54, 59, 501]);
  assert.equal(byMatch.get(59)?.[0].path, 'MatchZy/2026-08-06_59_memento.dem');
  assert.equal(byMatch.get(501)?.[0].path, 'MatchZy/2026-07-20_18-30-00_501_de_such.dem');
  assert.equal(byMatch.get(54)?.[0].path, 'MatchZy/54.dem');
});

// --- daysAgo ---

test('daysAgo: null input returns null (unknown age, never eligible)', () => {
  assert.equal(daysAgo(null), null);
});

test('daysAgo: a timestamp N days in the past returns approximately N', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const days = daysAgo(threeDaysAgo);
  assert.ok(days !== null && Math.abs(days - 3) < 0.01, `expected ~3, got ${days}`);
});

test('daysAgo: a future timestamp returns a negative number, not clamped to 0', () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const days = daysAgo(tomorrow);
  assert.ok(days !== null && days < 0, `expected negative, got ${days}`);
});

// --- parseModifiedAt ---

test('parseModifiedAt: detects Unix seconds vs. milliseconds by magnitude', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSeconds = parseModifiedAt(nowSec);
  const fromMillis = parseModifiedAt(nowSec * 1000);
  assert.ok(fromSeconds !== null && fromMillis !== null);
  assert.ok(Math.abs(fromSeconds.getTime() - fromMillis.getTime()) < 1000, 'both should resolve to ~now');
});

test('parseModifiedAt: undefined, non-numeric, zero, and negative values all return null', () => {
  assert.equal(parseModifiedAt(undefined), null);
  assert.equal(parseModifiedAt(NaN), null);
  assert.equal(parseModifiedAt(0), null);
  assert.equal(parseModifiedAt(-1), null);
});

test('parseModifiedAt: a value resolving before the 2020 floor is treated as unusable, not ancient', () => {
  // 1000 (seconds) -> year-1970 territory once ×1000 to ms; must not read as "extremely old" and
  // trigger deletion, the one unsafe direction here.
  assert.equal(parseModifiedAt(1000), null);
});

// --- residueAgeDays ---

test('residueAgeDays: uses the most recently modified file in the group, not the oldest', () => {
  const files = [
    file('a', 0, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)), // 10 days old
    file('b', 0, new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)), // 1 day old — still being written
  ];
  const days = residueAgeDays(files);
  assert.ok(days !== null && Math.abs(days - 1) < 0.01, `expected ~1 (newest file), got ${days}`);
});

test('residueAgeDays: null when none of the files have a resolvable timestamp', () => {
  const files = [file('a', 0, null), file('b', 0, null)];
  assert.equal(residueAgeDays(files), null);
});

test('residueAgeDays: ignores files with no timestamp when others in the group have one', () => {
  const files = [file('a', 0, null), file('b', 0, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))];
  const days = residueAgeDays(files);
  assert.ok(days !== null && Math.abs(days - 2) < 0.01, `expected ~2, got ${days}`);
});

report();
