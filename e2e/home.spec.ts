/**
 * E2E coverage for issue #696: the home page (`src/app/page.tsx`) composed end to end — signed out
 * (Login placeholder, no feedback banners), signed in (My Stats, Top duos linking to the
 * career H2H view, no Hottest Rivalries until a pair rates) and between seasons (the latest finished season's standings, no
 * Upcoming panel). The home page reads the whole league, so each test seeds its own played season
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

    await expect(page.getByRole('main').getByText('Login to see your stats')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toHaveAttribute('href', '/api/auth/steam');
    await expect(page.getByText('Post-season survey')).toHaveCount(0);
    await expect(page.getByText(/superlatives/i)).toHaveCount(0);
    // The standings are public.
    await expect(page.getByRole('main').getByText('Live', { exact: true })).toBeVisible();
  });

  test('signed in shows My Stats, and Top duos opens the career H2H view; Hottest Rivalries is hidden until a rivalry rates', async ({ page }) => {
    // Logs in from another page: the dev login updates the client session only, and the home
    // page is server-rendered, so it has to be fetched fresh once signed in.
    await loginAs(page, 'Zach', '/maps');
    await page.goto('/');

    // Top duos reads a 60-second cache that can predate this test's seeded
    // match (the web server's readiness probe fetches `/` first), so reload until it refreshes.
    test.setTimeout(150_000);
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('link', { name: 'Top duos', exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000] });

    // Scoped to the page's visible <main>: `getByText` also matches hidden nodes, and React can still
    // hold a streamed copy of the page in a hidden `<div hidden id="S:…">` just after a reload.
    const main = page.getByRole('main');
    await expect(main.getByText('My Stats', { exact: true })).toBeVisible();
    await expect(main.getByText('Match history', { exact: true })).toBeVisible();

    const duos = page.getByRole('link', { name: 'Top duos', exact: true });
    await expect(duos).toHaveAttribute('href', '/statistics?tab=h2h');
    await duos.click();
    await expect(page).toHaveURL(/\/statistics\?tab=h2h$/, { timeout: 30_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await page.goBack();

    // One played match gives every pair a single meeting, which rates 0, so the panel is omitted.
    await expect(page.getByRole('link', { name: 'Hottest Rivalries', exact: true })).toHaveCount(0);

    // A duo row opens that pair's career matchup on the same tab, as partners.
    const pairHref = 'a[href^="/statistics?tab=h2h&a="]';
    await page.locator(`${pairHref}:not([href*="type=opponent"])`).first().click();
    await expect(page).toHaveURL(/\/statistics\?tab=h2h&a=[^&]+&b=[^&]+$/, { timeout: 30_000 });
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });
});

test.describe('between seasons', () => {
  test.beforeEach(async () => {
    fixture = await seedPlayedMatchWithSabremetrics({ status: 'ARCHIVED' });
  });

  test("shows the latest finished season's standings and no Upcoming panel", async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('main').getByText('Final', { exact: true })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View all →' })).toHaveAttribute('href', `/seasons/${fixture!.seasonId}`);
    await expect(page.getByRole('link', { name: 'Upcoming', exact: true })).toHaveCount(0);
    await expect(page.getByText('To Be Scheduled')).toHaveCount(0);
  });
});
