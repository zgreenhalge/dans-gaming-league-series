/**
 * Unit tests for the pure, deterministic helpers in util.ts / maps.ts — the functions that
 * encode the project's hard invariants (canonical sort, played-match check, em-dash score parsing,
 * season pairing, and the shared rate derivation). These have all caused regressions before; lock
 * them down so a refactor can't silently change a ranking or a "did this match happen?" answer.
 *
 * Run (mirrors the EHOG parity test):
 *   npx vitest run src/lib/util.test.ts
 *
 * Assertions are plain `node:assert`, no matcher library — Vitest supplies the runner and reporter.
 */

import assert from 'node:assert/strict';
import {
  isPlayedScore,
  parseScore,
  extractSeasonNumber,
  canonicalSort,
  canonicalSortValues,
  fmtPct,
  fmtWindowDay,
  factionClass,
  formatCountdownClock,
  formatCountdownRelative,
  deriveRates,
  deriveRwr,
  deriveAdr,
  deriveKda,
  parseRouteId,
  weekWindow,
  matchLabel,
  seasonTitle,
  buildRegularToGauntletMap,
  findPairedSeason,
  nextRegularSeasonName,
  initials,
  firstName,
  winRatePct,
  compareMatchRefDesc,
  compareWithinSeasonDesc,
  avgOf,
  formatEhogDelta,
  fmtUtcShort,
  formatDuration,
  groupByMap,
  addNumericFields,
  finalRoundOf,
  finalRoundNumberOf,
  ordinal,
  mergeLeaderboardRows,
  formatSigned,
  roundTo,
  signedColor,
} from './util';
import type { LeaderboardRowWithId } from './types';
import { mapSlug } from './maps';
import { test, report } from './test-support/miniTest';

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

// --- isPlayedScore: null and "0-0" placeholders are NOT played (S3 pre-staged rows) ---
test('isPlayedScore: real score is played', () => {
  assert.equal(isPlayedScore('13-9'), true);
  assert.equal(isPlayedScore('13 – 9'), true); // em-dash
});
test('isPlayedScore: null / undefined / empty are not played', () => {
  assert.equal(isPlayedScore(null), false);
  assert.equal(isPlayedScore(undefined), false);
  assert.equal(isPlayedScore(''), false);
});
test('isPlayedScore: "0-0" placeholders (hyphen, em-dash, spaced) are not played', () => {
  assert.equal(isPlayedScore('0-0'), false);
  assert.equal(isPlayedScore('0 - 0'), false);
  assert.equal(isPlayedScore('0 – 0'), false);
});
test('isPlayedScore: a real 0-N or N-0 result IS played', () => {
  assert.equal(isPlayedScore('13-0'), true);
  assert.equal(isPlayedScore('0-13'), true);
});

// --- parseScore: handles both hyphen and em-dash ---
test('parseScore: hyphen and em-dash both parse', () => {
  assert.deepEqual(parseScore('13-9'), { shirts: 13, skins: 9 });
  assert.deepEqual(parseScore('13 – 9'), { shirts: 13, skins: 9 });
});
test('parseScore: null/garbage returns null', () => {
  assert.equal(parseScore(null), null);
  assert.equal(parseScore('not a score'), null);
});

// --- extractSeasonNumber: name-based season pairing ---
test('extractSeasonNumber: pulls the number from a season name', () => {
  assert.equal(extractSeasonNumber('Season 3'), 3);
  assert.equal(extractSeasonNumber('Season 12 Gauntlet'), 12);
  assert.equal(extractSeasonNumber('season 4'), 4); // case-insensitive
});
test('extractSeasonNumber: no number returns null', () => {
  assert.equal(extractSeasonNumber('Preseason'), null);
});

// --- canonicalSort: Wins → RWR% → ADR, all descending ---
const row = (wins: number, rwr: number, adr: number) => ({
  matches_won: wins,
  rwr_percentage: rwr,
  overall_adr: adr,
});
test('canonicalSort: orders by wins desc first', () => {
  const sorted = [row(5, 99, 99), row(8, 1, 1)].sort(canonicalSort);
  assert.equal(sorted[0].matches_won, 8);
});
test('canonicalSort: breaks wins ties with RWR% desc', () => {
  const sorted = [row(5, 40, 99), row(5, 60, 1)].sort(canonicalSort);
  assert.equal(sorted[0].rwr_percentage, 60);
});
test('canonicalSort: breaks wins+RWR% ties with ADR desc (never ADR alone)', () => {
  const sorted = [row(5, 50, 70), row(5, 50, 90)].sort(canonicalSort);
  assert.equal(sorted[0].overall_adr, 90);
});

// --- deriveRates: the single source for the four canonical-sort fields ---
test('deriveRates: computes WR / KD / RWR / ADR from totals', () => {
  const r = deriveRates({
    matches_played: 4,
    matches_won: 3,
    total_kills: 80,
    total_deaths: 40,
    total_rounds_played: 100,
    total_rounds_won: 55,
    total_damage: 9000,
  });
  approx(r.win_rate_percentage, 75);
  approx(r.kd_ratio, 2);
  approx(r.rwr_percentage, 55);
  approx(r.overall_adr, 90);
});
test('deriveRates: zero-guards (no division by zero, KD falls back to kills)', () => {
  const r = deriveRates({
    matches_played: 0,
    matches_won: 0,
    total_kills: 5,
    total_deaths: 0,
    total_rounds_played: 0,
    total_rounds_won: 0,
    total_damage: 0,
  });
  assert.equal(r.win_rate_percentage, 0);
  assert.equal(r.kd_ratio, 5); // deaths === 0 → kills, not Infinity
  assert.equal(r.rwr_percentage, 0);
  assert.equal(r.overall_adr, 0);
});

// --- deriveKda: (kills + assists) per death, with the deriveKd zero-death convention.
test('deriveKda: (kills + assists) / deaths, and kills + assists when there are no deaths', () => {
  assert.equal(deriveKda({ total_kills: 20, total_assists: 10, total_deaths: 15 }), 2);
  assert.equal(deriveKda({ total_kills: 5, total_assists: 3, total_deaths: 0 }), 8);
});

// --- deriveRwr / deriveAdr: deriveRates' narrower siblings, for callers without the full
// matches/kills totals in scope — must agree with deriveRates() on the same inputs ---
test('deriveRwr / deriveAdr: match deriveRates() on the same round/damage totals', () => {
  const totals = {
    matches_played: 4,
    matches_won: 3,
    total_kills: 80,
    total_deaths: 40,
    total_rounds_played: 100,
    total_rounds_won: 55,
    total_damage: 9000,
  };
  const r = deriveRates(totals);
  approx(deriveRwr(totals), r.rwr_percentage);
  approx(deriveAdr(totals), r.overall_adr);
});
test('deriveRwr / deriveAdr: zero-guard when no rounds played', () => {
  assert.equal(deriveRwr({ total_rounds_played: 0, total_rounds_won: 0 }), 0);
  assert.equal(deriveAdr({ total_rounds_played: 0, total_damage: 0 }), 0);
});

// --- parseRouteId: route `[id]` segment -> positive int4, or null ---
test('parseRouteId: accepts plain positive integers up to the int4 ceiling', () => {
  assert.equal(parseRouteId('1'), 1);
  assert.equal(parseRouteId('42'), 42);
  assert.equal(parseRouteId('2147483647'), 2147483647);
});
test('parseRouteId: rejects empty, zero, negative, fractional, exponent, hex, padded, and >int4 input', () => {
  for (const bad of ['', ' ', '0', '-1', '+1', '1.5', '1.0', '1e3', '0x10', ' 5', '5 ', 'abc', '2147483648', '99999999999999999999']) {
    assert.equal(parseRouteId(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- fmtUtcShort: deterministic, timezone-fixed short timestamp ---
test('fmtUtcShort: formats a fixed UTC timestamp regardless of local timezone', () => {
  assert.equal(fmtUtcShort('2026-03-05T18:30:00.000Z'), '03-05 18:30 UTC');
});
test('fmtUtcShort: null or an invalid date returns null, not "Invalid Date"', () => {
  assert.equal(fmtUtcShort(null), null);
  assert.equal(fmtUtcShort('not a date'), null);
});

// --- formatDuration: compact elapsed-time labels for admin job/duration surfaces ---
test('formatDuration: renders days/hours, hours/minutes, minutes, and sub-minute tiers', () => {
  assert.equal(formatDuration(3 * 24 * 60 * 60_000 + 4 * 60 * 60_000), '3d 4h');
  assert.equal(formatDuration(2 * 60 * 60_000 + 14 * 60_000), '2h 14m');
  assert.equal(formatDuration(45 * 60_000), '45m');
  assert.equal(formatDuration(30_000), '<1m');
});

test('formatDuration: negative input clamps to zero instead of going negative', () => {
  assert.equal(formatDuration(-1000), '<1m');
});

// --- matchLabel: "Season · Wk N · Match M", falling back to "Match #id" ---
test('matchLabel: builds the full label when all parts are present', () => {
  assert.equal(
    matchLabel({ matchId: 5, seasonName: 'Season 3', weekNumber: 2, matchNumber: 1 }),
    'Season 3 · Wk 2 · Match 1',
  );
});
test('matchLabel: falls back to "Match #id" when nothing else is known', () => {
  assert.equal(matchLabel({ matchId: 5 }), 'Match #5');
});

// --- weekWindow: 7-day UTC windows from a season start date ---
test('weekWindow: week 1 starts on the season start date', () => {
  const w = weekWindow('2026-03-01', 1);
  assert.equal(w?.start.toISOString().slice(0, 10), '2026-03-01');
  assert.equal(w?.end.toISOString().slice(0, 10), '2026-03-07');
});
test('weekWindow: week 3 is offset by 2 full weeks', () => {
  const w = weekWindow('2026-03-01', 3);
  assert.equal(w?.start.toISOString().slice(0, 10), '2026-03-15');
});
test('weekWindow: a null start date returns null', () => {
  assert.equal(weekWindow(null, 1), null);
});

// --- seasonTitle: canonical display title, falls back to the raw name ---
test('seasonTitle: normalizes to "Season N"', () => {
  assert.equal(seasonTitle('Season 4 Gauntlet'), 'Season 4');
});
test('seasonTitle: no season number falls back to the raw name', () => {
  assert.equal(seasonTitle('Preseason'), 'Preseason');
});

// --- buildRegularToGauntletMap: name-based season pairing, not ID-based ---
test('buildRegularToGauntletMap: pairs by season number even when ids are unrelated', () => {
  const regular = [{ id: 10, name: 'Season 1' }, { id: 20, name: 'Season 2' }];
  const gauntlet = [{ id: 99, name: 'Season 1 Gauntlet' }, { id: 5, name: 'Season 2 Gauntlet' }];
  const map = buildRegularToGauntletMap(regular, gauntlet);
  assert.equal(map.get(10), 99);
  assert.equal(map.get(20), 5);
});
test('buildRegularToGauntletMap: a regular season with no matching gauntlet is omitted', () => {
  const regular = [{ id: 10, name: 'Season 1' }];
  const map = buildRegularToGauntletMap(regular, []);
  assert.equal(map.has(10), false);
});

test('buildRegularToGauntletMap: duplicate gauntlet numbers resolve to the lowest id, whatever the input order', () => {
  const regular = [{ id: 10, name: 'Season 1' }];
  const gauntlet = [{ id: 30, name: 'Season 1 Gauntlet' }, { id: 20, name: 'Season 1 Gauntlet (redo)' }];
  assert.equal(buildRegularToGauntletMap(regular, gauntlet).get(10), 20);
});

// --- findPairedSeason: the one season ↔ gauntlet pairing rule ---
test('findPairedSeason: matches by season number, ignoring ids and the rest of the name', () => {
  const gauntlets = [{ id: 99, name: 'Season 1 Gauntlet' }, { id: 5, name: 'Season 2 Gauntlet' }];
  assert.equal(findPairedSeason('Season 2', gauntlets)?.id, 5);
  assert.equal(findPairedSeason('season 1', gauntlets)?.id, 99);
});
test('findPairedSeason: null when the name has no number or nothing shares it', () => {
  const gauntlets = [{ id: 5, name: 'Season 2 Gauntlet' }];
  assert.equal(findPairedSeason('Playoffs', gauntlets), null);
  assert.equal(findPairedSeason('Season 3', gauntlets), null);
  assert.equal(findPairedSeason('Season 2', []), null);
});
test('findPairedSeason: several candidates sharing the number resolve to the lowest id', () => {
  const dupes = [{ id: 30, name: 'Season 4' }, { id: 12, name: 'Season 4 (rerun)' }, { id: 20, name: 'Season 4' }];
  assert.equal(findPairedSeason('Season 4 Gauntlet', dupes)?.id, 12);
});

// --- nextRegularSeasonName ---
test('nextRegularSeasonName: one past the highest regular season number, ignoring gauntlets', () => {
  const seasons = [
    { name: 'Season 2 Regular Season', is_gauntlet: false },
    { name: 'Season 9 Gauntlet', is_gauntlet: true },
    { name: 'Season 4 Regular Season', is_gauntlet: false },
  ];
  assert.equal(nextRegularSeasonName(seasons), 'Season 5 Regular Season');
});
test('nextRegularSeasonName: starts at Season 1 when there are no numbered regular seasons', () => {
  assert.equal(nextRegularSeasonName([]), 'Season 1 Regular Season');
  assert.equal(nextRegularSeasonName([{ name: 'Playoffs', is_gauntlet: false }]), 'Season 1 Regular Season');
});

// --- initials / firstName ---
test('initials: two-word names use first letters of each word', () => {
  assert.equal(initials('Dan Smith'), 'DS');
});
test('initials: single-word names use the first two letters', () => {
  assert.equal(initials('Dan'), 'DA');
});
test('firstName: returns the first word', () => {
  assert.equal(firstName('  Dan Smith'), 'Dan');
});

// --- winRatePct ---
test('winRatePct: rounds to the nearest whole percent', () => {
  assert.equal(winRatePct(1, 3), 33);
});
test('winRatePct: zero games played returns 0, not NaN', () => {
  assert.equal(winRatePct(0, 0), 0);
});

// --- compareMatchRefDesc: season desc -> gauntlet-before-regular -> week desc -> match desc ---
function matchRef(overrides: Partial<{ seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number }>) {
  return { seasonNumber: 1, isGauntlet: false, weekNumber: 1, matchNumber: 1, ...overrides };
}
test('compareMatchRefDesc: higher season number sorts first', () => {
  const sorted = [matchRef({ seasonNumber: 1 }), matchRef({ seasonNumber: 3 })].sort(compareMatchRefDesc);
  assert.equal(sorted[0].seasonNumber, 3);
});
test('compareMatchRefDesc: within the same season number, gauntlet sorts before regular', () => {
  const sorted = [matchRef({ isGauntlet: false }), matchRef({ isGauntlet: true })].sort(compareMatchRefDesc);
  assert.equal(sorted[0].isGauntlet, true);
});
test('compareMatchRefDesc: ties break by week desc, then match number desc', () => {
  const sorted = [
    matchRef({ weekNumber: 1, matchNumber: 3 }),
    matchRef({ weekNumber: 2, matchNumber: 1 }),
  ].sort(compareMatchRefDesc);
  assert.equal(sorted[0].weekNumber, 2);
});
test('compareWithinSeasonDesc: week desc, then match number desc', () => {
  const sorted = [
    matchRef({ weekNumber: 1, matchNumber: 3 }),
    matchRef({ weekNumber: 2, matchNumber: 1 }),
    matchRef({ weekNumber: 2, matchNumber: 2 }),
  ].sort(compareWithinSeasonDesc);
  assert.deepEqual(sorted.map((m) => [m.weekNumber, m.matchNumber]), [[2, 2], [2, 1], [1, 3]]);
});

// --- avgOf / formatEhogDelta ---
test('avgOf: averages a list of numbers', () => {
  assert.equal(avgOf([1, 2, 3]), 2);
});
test('formatEhogDelta: prefixes a "+" for positive deltas, keeps "-" for negative, no sign on zero', () => {
  assert.equal(formatEhogDelta(1.25), '+1.3');
  assert.equal(formatEhogDelta(-1.25), '-1.3');
  assert.equal(formatEhogDelta(0), '0.0');
  assert.equal(formatEhogDelta(-0.04), '0.0');
});

// --- mapSlug: user-typed map names → stable URL segments ---
test('mapSlug: lowercases, trims, and dashes non-alphanumerics', () => {
  assert.equal(mapSlug('  Palais  '), 'palais');
  assert.equal(mapSlug('Train Yard'), 'train-yard');
});

// --- groupByMap: buckets by mapSlug(), so it always agrees with the replay-extract
//     Action's own mapSlug()-derived rollup key (issue #245) ---
test('groupByMap: names differing only in punctuation/spacing land in the same bucket', () => {
  const rows = [{ map: 'de dust 2' }, { map: 'de-dust-2' }];
  const buckets = groupByMap(rows, (r) => r.map);
  assert.equal(buckets.size, 1);
  assert.equal([...buckets.values()][0].rows.length, 2);
});
test('groupByMap: keeps the first-seen casing/spacing for display', () => {
  const rows = [{ map: 'De Dust 2' }, { map: 'de-dust-2' }];
  const buckets = groupByMap(rows, (r) => r.map);
  assert.equal([...buckets.values()][0].display, 'De Dust 2');
});
test('groupByMap: a null mapOf result excludes the row', () => {
  const rows = [{ map: 'Palais' }, { map: null }];
  const buckets = groupByMap(rows, (r) => r.map);
  assert.equal([...buckets.values()].reduce((n, b) => n + b.rows.length, 0), 1);
});

// --- addNumericFields: the shared per-record accumulation primitive behind addSabFields()
//     (queries/sabremetrics.ts) and mergeSabremetricResults() (parsers/segmentMerge.ts) ---
test('addNumericFields: sums numeric fields of b into a, in place', () => {
  const a = { kills: 10, deaths: 5, damage: 800 };
  addNumericFields(a, { kills: 3, deaths: 1, damage: 200 });
  assert.deepEqual(a, { kills: 13, deaths: 6, damage: 1000 });
});
test('addNumericFields: leaves non-numeric fields untouched', () => {
  const a = { kills: 10, name: 'p1' };
  addNumericFields(a, { kills: 3, name: 'p2' });
  assert.deepEqual(a, { kills: 13, name: 'p1' });
});

// --- finalRoundOf / finalRoundNumberOf: the bracket-aware final-round lookup (#565) ---
test('finalRoundOf: an explicit finalRoundNumber wins over any is_final_round flag or highest round_number', () => {
  const rounds = [
    { round_number: 1, is_final_round: false },
    { round_number: 2, is_final_round: true }, // would win under the old flag-based lookup
  ];
  assert.equal(finalRoundOf(rounds, 1)?.round_number, 1);
});
test('finalRoundOf: an explicit finalRoundNumber not present in rounds returns undefined (not yet scheduled)', () => {
  const rounds = [{ round_number: 1, is_final_round: false }];
  assert.equal(finalRoundOf(rounds, 2), undefined);
});
test('finalRoundOf: finalRoundNumber: null falls back to the highest round_number, same as omitting it', () => {
  const rounds = [{ round_number: 1 }, { round_number: 3 }, { round_number: 2 }];
  assert.equal(finalRoundOf(rounds, null)?.round_number, 3);
  assert.equal(finalRoundOf(rounds)?.round_number, 3);
});
test('finalRoundOf: finalRoundNumber: null still prefers a declared is_final_round flag over the highest round_number, same as omitting it', () => {
  const rounds = [
    { round_number: 1, is_final_round: false },
    { round_number: 2, is_final_round: true },
    { round_number: 3, is_final_round: false },
  ];
  assert.equal(finalRoundOf(rounds, null)?.round_number, 2);
  assert.equal(finalRoundOf(rounds)?.round_number, 2);
});
test('finalRoundNumberOf: returns the final pod\'s round_number, or null when no pod is final', () => {
  assert.equal(finalRoundNumberOf([{ round_number: 1, is_final: false }, { round_number: 2, is_final: true }]), 2);
  assert.equal(finalRoundNumberOf([]), null);
});

// --- canonicalSortValues: the same order for wins/rwr/adr-shaped rows ---

test('canonicalSortValues: Wins → RWR% → ADR, all descending', () => {
  const rows = [
    { id: 'a', wins: 5, rwr: 50, adr: 70 },
    { id: 'b', wins: 5, rwr: 50, adr: 90 },
    { id: 'c', wins: 5, rwr: 60, adr: 1 },
    { id: 'd', wins: 8, rwr: 1, adr: 1 },
  ];
  assert.deepEqual(rows.sort(canonicalSortValues).map((r) => r.id), ['d', 'c', 'b', 'a']);
});

test('fmtWindowDay: formats a YYYY-MM-DD date without shifting the day', () => {
  assert.equal(fmtWindowDay('2026-10-12'), 'Oct 12');
});

// --- fmtPct / factionClass / countdowns ---

test('fmtPct: rounds to a whole percent, dash on a zero denominator', () => {
  assert.equal(fmtPct(1, 3), '33%');
  assert.equal(fmtPct(2, 3), '67%');
  assert.equal(fmtPct(0, 0), '—');
});

test('factionClass: side tint class, empty for no side', () => {
  assert.equal(factionClass('CT'), 'faction-ct');
  assert.equal(factionClass('T'), 'faction-t');
  assert.equal(factionClass(null), '');
  assert.equal(factionClass(undefined), '');
});

test('formatCountdownClock: HH:MM:SS with a day prefix once it spans a day', () => {
  assert.equal(formatCountdownClock(0), 'starting now');
  assert.equal(formatCountdownClock(3_661_000), '01:01:01');
  assert.equal(formatCountdownClock(86_400_000 + 5_000), '1 day 00:00:05');
  assert.equal(formatCountdownClock(2 * 86_400_000), '2 days 00:00:00');
});

test('formatCountdownRelative: future reads "in …", past reads "… ago"', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(formatCountdownRelative('2026-01-01T00:00:05Z', now), 'in 5s');
  assert.equal(formatCountdownRelative('2026-01-02T01:02:03Z', now), 'in 1d 1h 2m 3s');
  assert.equal(formatCountdownRelative('2025-12-31T23:58:00Z', now), '2m 0s ago');
});

test('ordinal: st / nd / rd / th, with 11-13 always th', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(ordinal), ['1st', '2nd', '3rd', '4th', '10th']);
  assert.deepEqual([11, 12, 13, 14].map(ordinal), ['11th', '12th', '13th', '14th']);
  assert.deepEqual([21, 22, 23, 101, 111, 112].map(ordinal), ['21st', '22nd', '23rd', '101st', '111th', '112th']);
});

function lbRow(playerId: number, overrides: Partial<LeaderboardRowWithId> = {}): LeaderboardRowWithId {
  return {
    season_id: 1,
    player_id: playerId,
    player_name: `P${playerId}`,
    matches_played: 2,
    matches_won: 1,
    matches_lost: 1,
    win_rate_percentage: 50,
    total_kills: 20,
    total_assists: 4,
    total_deaths: 10,
    kd_ratio: 2,
    total_damage: 2000,
    total_rounds_played: 40,
    total_rounds_won: 20,
    rwr_percentage: 50,
    overall_adr: 50,
    kills_in_wins: 10,
    deaths_in_wins: 5,
    kills_in_losses: 10,
    deaths_in_losses: 5,
    ...overrides,
  };
}

test('mergeLeaderboardRows: sums a shared player\'s totals and re-derives their rates; others pass through', () => {
  const merged = mergeLeaderboardRows(
    [lbRow(1), lbRow(2)],
    [lbRow(1, { matches_played: 1, matches_won: 1, matches_lost: 0, total_rounds_played: 10, total_rounds_won: 10, total_damage: 1000, total_kills: 8, total_deaths: 2 })],
  );
  assert.equal(merged.length, 2);
  const p1 = merged.find((r) => r.player_id === 1)!;
  assert.equal(p1.season_id, -1);
  assert.equal(p1.matches_played, 3);
  assert.equal(p1.matches_won, 2);
  assert.equal(p1.matches_lost, 1);
  assert.equal(p1.total_rounds_played, 50);
  assert.equal(p1.total_rounds_won, 30);
  assert.equal(p1.rwr_percentage, 60);
  assert.equal(p1.overall_adr, 60);
  assert.equal(p1.kd_ratio, 28 / 12);
  assert.deepEqual(merged.find((r) => r.player_id === 2), lbRow(2));
});

test('roundTo: rounds to the decimals a figure shows, so a sign can be judged at that precision', () => {
  assert.equal(roundTo(1.25, 1), 1.3);
  assert.equal(roundTo(-0.004, 2), -0); // a negative that rounds to zero is zero (-0 === 0)
  assert.equal(roundTo(-0.004, 2) < 0, false);
  assert.equal(roundTo(2.5, 0), 3);
});

test('formatSigned: explicit plus when positive, rounded first so a zero never shows a sign', () => {
  assert.equal(formatSigned(1.46, 1), '+1.5');
  assert.equal(formatSigned(-0.44, 1), '-0.4');
  assert.equal(formatSigned(0, 1), '0.0');
  assert.equal(formatSigned(-0.04, 1), '0.0');
  assert.equal(formatSigned(4.4, 0), '+4');
});

test('signedColor: green above zero, red below, none at zero, judged at the displayed precision', () => {
  assert.equal(signedColor(0.5, 1), 'var(--color-accent-green-fg)');
  assert.equal(signedColor(-0.5, 1), 'var(--color-accent-red-fg)');
  assert.equal(signedColor(0, 1), undefined);
  assert.equal(signedColor(-0.04, 1), undefined);
});

report();
