/**
 * Unit tests for the pure, deterministic helpers in util.ts / maps.ts — the functions that
 * encode the project's hard invariants (canonical sort, played-match check, em-dash score parsing,
 * season pairing, and the shared rate derivation). These have all caused regressions before; lock
 * them down so a refactor can't silently change a ranking or a "did this match happen?" answer.
 *
 * Run (mirrors the EHOG parity test):
 *   npx tsx src/lib/util.test.ts
 *
 * No test framework — just `node:assert` and a tiny runner, to keep zero dependencies.
 */

import assert from 'node:assert/strict';
import {
  isPlayedScore,
  parseScore,
  extractSeasonNumber,
  canonicalSort,
  deriveRates,
  parseMatchId,
  weekWindow,
  matchLabel,
  seasonTitle,
  buildRegularToGauntletMap,
  initials,
  firstName,
  winRatePct,
  compareMatchRefDesc,
  avgOf,
  formatEhogDelta,
  fmtUtcShort,
  canonicalGauntletRankMap,
} from './util';
import { mapSlug } from './maps';

let passed = 0;
const failures: string[] = [];

function approx(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ~${expected}, got ${actual}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
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

// --- canonicalSort: WR% → RWR% → ADR, all descending ---
const row = (wr: number, rwr: number, adr: number) => ({
  win_rate_percentage: wr,
  rwr_percentage: rwr,
  overall_adr: adr,
});
test('canonicalSort: orders by WR% desc first', () => {
  const sorted = [row(50, 99, 99), row(80, 1, 1)].sort(canonicalSort);
  assert.equal(sorted[0].win_rate_percentage, 80);
});
test('canonicalSort: breaks WR% ties with RWR% desc', () => {
  const sorted = [row(50, 40, 99), row(50, 60, 1)].sort(canonicalSort);
  assert.equal(sorted[0].rwr_percentage, 60);
});
test('canonicalSort: breaks WR%+RWR% ties with ADR desc (never ADR alone)', () => {
  const sorted = [row(50, 50, 70), row(50, 50, 90)].sort(canonicalSort);
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

// --- parseMatchId: route param -> positive integer, or null ---
test('parseMatchId: accepts a positive integer string', () => {
  assert.equal(parseMatchId('42'), 42);
});
test('parseMatchId: rejects zero, negatives, and non-numeric strings', () => {
  assert.equal(parseMatchId('0'), null);
  assert.equal(parseMatchId('-5'), null);
  assert.equal(parseMatchId('abc'), null);
  assert.equal(parseMatchId('4.5'), null);
});

// --- fmtUtcShort: deterministic, timezone-fixed short timestamp ---
test('fmtUtcShort: formats a fixed UTC timestamp regardless of local timezone', () => {
  assert.equal(fmtUtcShort('2026-03-05T18:30:00.000Z'), '03-05 18:30 UTC');
});
test('fmtUtcShort: null or an invalid date returns null, not "Invalid Date"', () => {
  assert.equal(fmtUtcShort(null), null);
  assert.equal(fmtUtcShort('not a date'), null);
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

// --- avgOf / formatEhogDelta ---
test('avgOf: averages a list of numbers', () => {
  assert.equal(avgOf([1, 2, 3]), 2);
});
test('formatEhogDelta: prefixes a "+" for non-negative deltas, keeps "-" for negative', () => {
  assert.equal(formatEhogDelta(1.25), '+1.3');
  assert.equal(formatEhogDelta(-1.25), '-1.3');
  assert.equal(formatEhogDelta(0), '+0.0');
});

// --- canonicalGauntletRankMap: the podium-order gauntlet ranking ---
type P = { player_id: number; faction: 'SHIRTS' | 'SKINS'; is_win: boolean; adr: number };
function gp(player_id: number, faction: 'SHIRTS' | 'SKINS', is_win: boolean, adr = 80): P {
  return { player_id, faction, is_win, adr };
}

test('canonicalGauntletRankMap: no rounds returns an empty map', () => {
  assert.equal(canonicalGauntletRankMap([]).size, 0);
});

test('canonicalGauntletRankMap: an incomplete final round returns an empty map', () => {
  const rounds = [
    {
      round_number: 1,
      matches: [
        {
          final_score: '0-0', // unplayed
          shirts_stats: [gp(1, 'SHIRTS', false)],
          skins_stats: [gp(2, 'SKINS', false)],
        },
      ],
    },
  ];
  assert.equal(canonicalGauntletRankMap(rounds).size, 0);
});

test('canonicalGauntletRankMap: final-round wins rank above ties, RWR% breaks ties, and earlier eliminations rank lower', () => {
  const rounds = [
    // Round 1 (non-final): p5 loses to p8 and is never seen again -> eliminated round 1.
    {
      round_number: 1,
      matches: [
        {
          final_score: '13-10',
          shirts_stats: [gp(5, 'SHIRTS', false, 50)],
          skins_stats: [gp(8, 'SKINS', true, 55)],
        },
      ],
    },
    // Round 2 (non-final): p8 loses to p9; neither reaches the final -> both eliminated round 2.
    {
      round_number: 2,
      matches: [
        {
          final_score: '13-11',
          shirts_stats: [gp(8, 'SHIRTS', false, 60)],
          skins_stats: [gp(9, 'SKINS', true, 65)],
        },
      ],
    },
    // Round 3 (final): two independent 1v1s. p1 and p3 each go 1-0 (tie broken by RWR%);
    // p2 and p4 each go 0-1 (tie broken by RWR%).
    {
      round_number: 3,
      matches: [
        {
          final_score: '13-9', // 22 rounds total
          shirts_stats: [gp(1, 'SHIRTS', true, 90)],
          skins_stats: [gp(2, 'SKINS', false, 70)],
        },
        {
          final_score: '13-11', // 24 rounds total
          shirts_stats: [gp(3, 'SHIRTS', true, 85)],
          skins_stats: [gp(4, 'SKINS', false, 65)],
        },
      ],
    },
  ];

  const rank = canonicalGauntletRankMap(rounds);

  // p1 RWR 13/22 ≈ .591 beats p3's 13/24 ≈ .542 -> p1 above p3 despite an equal 1-0 record.
  assert.equal(rank.get(1), 1);
  assert.equal(rank.get(3), 2);
  // p4 RWR 11/24 ≈ .458 beats p2's 9/22 ≈ .409 -> p4 above p2 despite an equal 0-1 record.
  assert.equal(rank.get(4), 3);
  assert.equal(rank.get(2), 4);
  // Eliminated in round 2 ranks above eliminated in round 1, regardless of that round's record.
  assert.ok((rank.get(9) as number) < (rank.get(5) as number));
  assert.ok((rank.get(8) as number) < (rank.get(5) as number));
  // Within round-2 eliminations, the round-2 winner (p9) ranks above the round-2 loser (p8).
  assert.ok((rank.get(9) as number) < (rank.get(8) as number));
});

// --- mapSlug: user-typed map names → stable URL segments ---
test('mapSlug: lowercases, trims, and dashes non-alphanumerics', () => {
  assert.equal(mapSlug('  Palais  '), 'palais');
  assert.equal(mapSlug('Train Yard'), 'train-yard');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
