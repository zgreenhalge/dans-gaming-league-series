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

/** Clicks every `role="tab"` button on the page, including ones that only appear once an earlier
 *  tab has been selected (e.g. Advanced Stats' own side/sub-tab bar) — repeats until a pass finds
 *  nothing new to click. Keyed by visible label text, so a same-labeled tab under a different
 *  parent won't get a second click; harmless for a smoke pass that just needs every tab reached
 *  once. */
async function clickThroughTabs(page: Page): Promise<void> {
  const clicked = new Set<string>();
  for (let round = 0; round < 8; round++) {
    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    let clickedThisRound = false;
    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      if (!(await tab.isVisible())) continue;
      const label = (await tab.textContent())?.trim() || `tab-${i}`;
      if (clicked.has(label)) continue;
      clicked.add(label);
      clickedThisRound = true;
      await tab.click();
      await assertNoErrorBoundary(page);
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
