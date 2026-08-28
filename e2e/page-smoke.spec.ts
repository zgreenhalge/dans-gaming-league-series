/**
 * E2E coverage for issue #480: a shallow smoke pass over every top-level page type, clicking
 * through each page's visible tabs and asserting the app never falls back to the route
 * `error.tsx`/`global-error.tsx` boundary ("Something went wrong"). Deliberately not a check of
 * specific behavior — that's what the targeted specs and `queries-*.test.ts` regression harness
 * are for — just the one thing neither of those can catch: a page that forgot to wrap a client
 * component in a context provider it needs (`UrlStateProvider`, see #477's `matches/[id]` gap),
 * which only breaks once you're on that exact page. See docs/e2e.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedPlayedMatchWithSabremetrics, teardownMatch, type TestMatch } from './support/db';

let fixture: TestMatch;

test.beforeEach(async () => {
  fixture = await seedPlayedMatchWithSabremetrics();
});

test.afterEach(async () => {
  await teardownMatch(fixture);
});

async function assertNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

/** Clicks every tab in every `role="tablist"` on the page, including a sub-tab bar that only
 *  mounts once its parent tab is selected (e.g. Advanced Stats' own sub-tabs) — repeats until a
 *  pass finds nothing new, which is what reaches those. Tracked as `` `${tablist index}:${tab
 *  index}` `` rather than visible label text, so two tab bars that happen to share a label (e.g. a
 *  season's own tabs and its linked gauntlet's) can't cause one to be skipped in place of the
 *  other — each tablist's own tab buttons are a fixed set for the page's lifetime (only the
 *  selected content pane changes), so a position within one stays valid across rounds. */
async function clickThroughTabs(page: Page): Promise<void> {
  const clicked = new Set<string>();
  for (let round = 0; round < 8; round++) {
    const tablists = page.getByRole('tablist');
    const tablistCount = await tablists.count();
    let clickedThisRound = false;
    for (let t = 0; t < tablistCount; t++) {
      const tabs = tablists.nth(t).getByRole('tab');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        const key = `${t}:${i}`;
        if (clicked.has(key)) continue;
        clicked.add(key);
        clickedThisRound = true;
        await tabs.nth(i).click();
        await assertNoErrorBoundary(page);
      }
    }
    if (!clickedThisRound) break;
  }
}

test('every top-level page renders and every tab is reachable without hitting the error boundary', async ({ page }) => {
  await test.step('home', async () => {
    await page.goto('/');
    await assertNoErrorBoundary(page);
    await clickThroughTabs(page);
  });

  await test.step('match', async () => {
    await page.goto(`/matches/${fixture.matchId}`);
    await assertNoErrorBoundary(page);
    // The exact tab #480 exists for: SabremetricsLeaderboardView needs UrlStateProvider.
    await expect(page.getByRole('tab', { name: 'Advanced Stats' })).toBeVisible();
    await clickThroughTabs(page);
  });

  await test.step('player', async () => {
    await page.goto(`/players/${fixture.playerIds[0]}`);
    await assertNoErrorBoundary(page);
    await clickThroughTabs(page);
  });

  await test.step('season', async () => {
    await page.goto(`/seasons/${fixture.seasonId}`);
    await assertNoErrorBoundary(page);
    await clickThroughTabs(page);
  });

  await test.step('maps', async () => {
    await page.goto('/maps');
    await assertNoErrorBoundary(page);
    await clickThroughTabs(page);
  });

  await test.step('statistics', async () => {
    await page.goto('/statistics');
    await assertNoErrorBoundary(page);
    await clickThroughTabs(page);
  });
});
