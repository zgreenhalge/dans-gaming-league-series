/**
 * E2E coverage for issue #696: the home page (`src/app/page.tsx`) composed end to end — signed out
 * (Login placeholder, no feedback banners), signed in (My Stats, Top duos / Hottest Rivalries
 * linking to the career H2H view) and between seasons (the latest finished season's standings, no
 * Upcoming Games). The home page reads the whole league, so each test seeds its own played season
 * and the suite runs on one worker; see docs/e2e.md.
 */

import { test, expect } from '@playwright/test';
import { loginAs } from './support/auth';
import { seedPlayedMatchWithSabremetrics, teardownMatch, type TestMatch } from './support/db';

let fixture: TestMatch | null = null;

test.afterEach(async () => {
  if (fixture) await teardownMatch(fixture);
  fixture = null;
});

test.describe('with a running season', () => {
  test.beforeEach(async () => {
    fixture = await seedPlayedMatchWithSabremetrics();
  });

  test('signed out shows the Login placeholder and no feedback banners', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Login to see your stats')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toHaveAttribute('href', '/api/auth/steam');
    await expect(page.getByText('Post-season survey')).toHaveCount(0);
    await expect(page.getByText(/superlatives/i)).toHaveCount(0);
    // The standings are public.
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
  });

  test('signed in shows My Stats, and Top duos and Hottest Rivalries open the career H2H view', async ({ page }) => {
    // Logs in from another page: the dev login updates the client session only, and the home
    // page is server-rendered, so it has to be fetched fresh once signed in.
    await loginAs(page, 'Zach', '/maps');
    await page.goto('/');

    await expect(page.getByText('My Stats', { exact: true })).toBeVisible();
    await expect(page.getByText('Match history', { exact: true })).toBeVisible();

    for (const title of ['Top duos', 'Hottest Rivalries']) {
      const link = page.getByRole('link', { name: title, exact: true });
      await expect(link).toHaveAttribute('href', '/statistics?tab=h2h');
      await link.click();
      await expect(page).toHaveURL(/\/statistics\?tab=h2h$/, { timeout: 30_000 });
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
      await page.goBack();
    }

    // A pair row opens that pair's career matchup on the same tab: a duo as partners, a
    // rivalry as opponents (`type=opponent`).
    const pairHref = 'a[href^="/statistics?tab=h2h&a="]';
    await page.locator(`${pairHref}:not([href*="type=opponent"])`).first().click();
    await expect(page).toHaveURL(/\/statistics\?tab=h2h&a=[^&]+&b=[^&]+$/, { timeout: 30_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await page.goBack();

    await page.locator(`${pairHref}[href*="type=opponent"]`).first().click();
    await expect(page).toHaveURL(/\/statistics\?tab=h2h&.*type=opponent/, { timeout: 30_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});

test.describe('between seasons', () => {
  test.beforeEach(async () => {
    fixture = await seedPlayedMatchWithSabremetrics({ status: 'ARCHIVED' });
  });

  test("shows the latest finished season's standings and no Upcoming Games", async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Final', { exact: true })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View all →' })).toHaveAttribute('href', `/seasons/${fixture!.seasonId}`);
    await expect(page.getByText('Upcoming Games')).toHaveCount(0);
    await expect(page.getByText('To Be Scheduled')).toHaveCount(0);
  });
});
