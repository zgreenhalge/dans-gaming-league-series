/**
 * Sweep over the settings grid: every setting `formatIssues()` accepts builds a plan with
 * `buildFormatPlan()` instead of throwing, every setting it refuses comes back `{ ok: false }`, and
 * every built plan keeps the cheap structural invariants. Plans are built at a small `effort` (a
 * short annealing search), so the sweep covers structure — which division-size and week-count
 * combinations crash — not plan quality; `season-format.test.ts` covers quality at full effort.
 *
 * `npm test` runs a spread of the grid in seconds; `npm run test:format-sweep` runs all of it
 * (players 4-24, divisions 1-3, weeks 1-16), which takes a couple of minutes.
 *
 * Run:  npx vitest run src/lib/season-format.sweep.test.ts
 */

import assert from 'node:assert/strict';
import { fromEhog, SIGMA_DEFAULT } from './ehog';
import {
  buildFormatPlan,
  formatIssues,
  reshuffles,
  FORMAT_MAX_WEEKS,
  FORMAT_MIN_WEEKS,
  type DraftOrder,
  type FormatPlan,
  type FormatPlayer,
  type SeasonFormatSettings,
  type WeekShape,
} from './season-format';
import { test, report } from './test-support/miniTest';

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 24;
const MAX_DIVISIONS = 3;
/** The annealing search length as a fraction of a normal build's. */
const SWEEP_EFFORT = 0.01;
const FULL = process.env.FORMAT_SWEEP === 'full';
const SWEEP_TIMEOUT_MS = 600_000;

/** The default grid: roster sizes either side of each division-size boundary, and week counts that
 *  cover idle weeks, doubleheaders and odd and even halves. */
const SPREAD_PLAYERS = new Set([4, 5, 8, 9, 13, 24]);
const SPREAD_WEEKS = new Set([1, 2, 5, 8, 9, 16]);

const WEEK_SHAPES: WeekShape[] = ['match', 'group'];
/** The draft order decides who sits in which division, never how a division's weeks are laid out,
 *  so the snake draft covers every week count and the others a spread of them. */
const OTHER_DRAFT_ORDERS: DraftOrder[] = ['balanced', 'tiered'];
const OTHER_DRAFT_WEEKS = new Set(FULL ? [1, 2, 3, 5, 8, 9, 13, 16] : [2, 9]);

function equalGames(plan: FormatPlan): boolean {
  const { min, max } = plan.scorecard.gamesPerPlayer;
  return min === max;
}

const rosters = new Map<number, FormatPlayer[]>();

/** `n` players spread evenly from EHOG 90 down to 15, ids 1..n in rating order. */
function roster(n: number): FormatPlayer[] {
  let players = rosters.get(n);
  if (!players) {
    players = Array.from({ length: n }, (_, i) => {
      const ehog = 90 - (75 * i) / Math.max(1, n - 1);
      return { playerId: i + 1, mu: fromEhog(ehog, SIGMA_DEFAULT), sigma: SIGMA_DEFAULT, ehogRating: ehog };
    });
    rosters.set(n, players);
  }
  return players;
}

/** Every combination in the grid: both week shapes, a halfway shuffle on and off, the snake draft
 *  at every week count, and the balanced and tiered drafts (tiered splits the roster evenly) at a
 *  spread of week counts. */
function* grid(): Generator<{ n: number; settings: SeasonFormatSettings }> {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    if (!FULL && !SPREAD_PLAYERS.has(n)) continue;
    for (let divisions = 1; divisions <= MAX_DIVISIONS; divisions++) {
      for (let weeks = FORMAT_MIN_WEEKS; weeks <= FORMAT_MAX_WEEKS; weeks++) {
        if (!FULL && !SPREAD_WEEKS.has(weeks)) continue;
        for (const weekShape of WEEK_SHAPES) {
          for (const halfwayShuffle of [false, true]) {
            const draftOrders: DraftOrder[] = OTHER_DRAFT_WEEKS.has(weeks) ? ['snake', ...OTHER_DRAFT_ORDERS] : ['snake'];
            for (const draftOrder of draftOrders) {
              yield {
                n,
                settings: {
                  weeks,
                  weekShape,
                  divisions,
                  draftBasis: 'ehog',
                  draftOrder,
                  tierSizes: null,
                  halfwayShuffle,
                  halfwayRedraft: n % 2 === 0 ? 'win-rate' : 'new-pairings',
                  ehogBalance: true,
                  seed: n + weeks,
                },
              };
            }
          }
        }
      }
    }
  }
}

test(
  'every setting formatIssues() accepts builds a sound plan, and every one it refuses returns ok: false',
  () => {
    const problems: string[] = [];
    let accepted = 0;
    let refused = 0;
    for (const { n, settings } of grid()) {
      const label = `${n} players ${JSON.stringify(settings)}`;
      const issues = formatIssues(n, settings);
      let result;
      try {
        result = buildFormatPlan(roster(n), settings, { effort: SWEEP_EFFORT });
      } catch (e) {
        problems.push(`${label}: buildFormatPlan() threw ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (issues.length > 0) {
        refused++;
        if (result.ok || result.issues.join() !== issues.join()) problems.push(`${label}: a refused setting must return its issues`);
        continue;
      }
      accepted++;
      if (!result.ok) {
        problems.push(`${label}: an accepted setting must build, got ${result.issues.join(' ')}`);
        continue;
      }
      const { plan } = result;
      if (plan.weeks.length !== settings.weeks) problems.push(`${label}: ${plan.weeks.length} weeks`);
      if (!plan.weeks.every((w) => w.divisions.some((d) => d.games.length > 0))) problems.push(`${label}: a week has no games`);
      if (!reshuffles(settings) && !equalGames(plan)) {
        // Equal game counts are a search cost term, not a structural guarantee, so a short search
        // can miss them; a normal build must not.
        const full = buildFormatPlan(roster(n), settings);
        if (!full.ok || !equalGames(full.plan)) problems.push(`${label}: games per player are unequal even at full effort`);
      }
    }
    // Guards against a grid that stops reaching either branch.
    assert.ok(accepted > 0 && refused > 0, `accepted ${accepted}, refused ${refused}`);
    assert.deepEqual(problems.slice(0, 10), [], `${problems.length} of ${accepted + refused} settings failed`);
  },
  SWEEP_TIMEOUT_MS,
);

report();
