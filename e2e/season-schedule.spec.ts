/**
 * E2E coverage for the highest-priority flow in issue #413: season schedule
 * generate → confirm → match creation. Smallest fixture footprint of the three flows the issue
 * scopes (one season + a 7-player roster, no demo file, no gauntlet pod structure) — see
 * docs/e2e.md for the auth/fixture/CI design this suite runs under.
 *
 * Regression lock for #320's schedule-confirm atomicity gap while that's unresolved: this test
 * exercises the exact generate → confirm path #320 is about, through the real UI and a real
 * (disposable) season, not a mock.
 */

import { test, expect } from '@playwright/test';
import { loginAs } from './support/auth';
import { seedSchedulableSeason, teardownSeason, type TestSeason } from './support/db';

let season: TestSeason;

test.beforeEach(async () => {
  season = await seedSchedulableSeason();
});

test.afterEach(async () => {
  await teardownSeason(season.seasonId);
});

test('generating a schedule, then confirming it, materializes real weeks and matches', async ({ page }) => {
  await loginAs(page, 'Zach'); // the seeded admin

  await page.goto(`/admin/seasons/schedule/${season.seasonId}`);
  // .first(): same reasoning as the `Match 1` locator below — CI's cold-start `next dev` compile
  // of this not-yet-visited route can paint the empty-state text twice before settling, same
  // symptom class Playwright strict mode would otherwise fail on.
  await expect(page.getByText(/No schedule yet/i).first()).toBeVisible();

  await page.getByRole('button', { name: 'Generate Schedule' }).click();
  // Regenerates the page's server data via router.refresh() — wait for the draft's weeks to render.
  await expect(page.getByText(/^Week 1$/)).toBeVisible();

  // A 7-player round-robin draft is complete by construction (season-schedule-engine.ts guarantees
  // every pair teams and opposes at least once) — no hand-editing needed before confirming.
  await expect(page.getByText(/Every pair plays together and against each other/i)).toBeVisible();

  const confirmButton = page.getByRole('button', { name: 'Confirm Schedule' });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  // confirmDraft() router.push()es to the season page on success.
  await expect(page).toHaveURL(new RegExp(`/seasons/${season.seasonId}$`));
  await expect(page.getByText(/Match 1/i).first()).toBeVisible();
});

test('the confirm button stays disabled until the draft is complete', async ({ page }) => {
  await loginAs(page, 'Zach');

  await page.goto(`/admin/seasons/schedule/${season.seasonId}`);
  await page.getByRole('button', { name: 'Generate Schedule' }).click();
  await expect(page.getByText(/^Week 1$/)).toBeVisible();

  // Reroute every Match 1 shirts-slot-0 dropdown to the same player as its shirts-slot-1 —
  // creates a self-paired match, which validateDraftIntegrity() flags and confirm gates on.
  const firstMatchSelects = page.locator('select').first();
  const otherSlotValue = await page.locator('select').nth(1).inputValue();
  await firstMatchSelects.selectOption(otherSlotValue);

  await expect(page.getByRole('button', { name: 'Confirm Schedule' })).toBeDisabled();
});
