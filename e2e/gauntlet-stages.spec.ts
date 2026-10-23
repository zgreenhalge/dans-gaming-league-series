/**
 * E2E coverage for issue #654: the week, round and group pages (`/seasons/[id]/weeks/[weekId]`,
 * `/rounds/[round]`, `/groups/[podId]`) against a seeded gauntlet — a paired regular season and
 * gauntlet whose round 1 has two played groups (an elimination pod and a wildcard pod) and whose
 * round 2 is an unscheduled final (`seedGauntletWithPods()`). Walks week → Gauntlet chip → round →
 * group → Regular season chip, then checks the collapsible group sections, the canonical-URL
 * redirects, the 404s, the Open Graph metadata and images, and the phone-width layout. See
 * docs/e2e.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedGauntletWithPods, teardownGauntlet, type TestGauntlet } from './support/db';

let fixture: TestGauntlet;

test.beforeEach(async () => {
  fixture = await seedGauntletWithPods();
});

test.afterEach(async () => {
  await teardownGauntlet(fixture);
});

const weekPath = () => `/seasons/${fixture.hubSeasonId}/weeks/${fixture.hubWeekId}`;
const roundPath = (round: number) => `/seasons/${fixture.hubSeasonId}/rounds/${round}`;
const groupPath = (podId: number) => `/seasons/${fixture.hubSeasonId}/groups/${podId}`;
const matchLink = (page: Page, matchId: number) => page.locator(`a[href="/matches/${matchId}"]`);

async function assertNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

/** Asserts the browser ended up on `path` (no query), after any redirects. */
async function expectPath(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), { timeout: 30_000 });
}

test('walks week, Gauntlet chip, round, group and Regular season chip', async ({ page }) => {
  await test.step('week page', async () => {
    await page.goto(weekPath());
    await assertNoErrorBoundary(page);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText(`Season ${fixture.seasonNumber}`);
    await expect(heading).toContainText('Week 1');
    await expect(page.getByRole('heading', { name: 'Scorecard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible();
    await expect(matchLink(page, fixture.hubMatchId)).toBeVisible();
    // Week 1 alone is not a chip strip; the Gauntlet chip is the strip's only content.
    const gauntletChip = page.getByRole('navigation', { name: 'Weeks' }).getByRole('link', { name: 'Gauntlet →' });
    await expect(gauntletChip).toHaveAttribute('href', roundPath(1));
    await gauntletChip.click();
  });

  await test.step('round page', async () => {
    await expectPath(page, roundPath(1));
    await assertNoErrorBoundary(page);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText(`Season ${fixture.seasonNumber} Gauntlet`);
    await expect(heading).toContainText('Round 1');
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();

    const rounds = page.getByRole('navigation', { name: 'Rounds' });
    await expect(rounds.locator('[aria-current="page"]')).toHaveText('1');
    await expect(rounds.getByRole('link', { name: '2', exact: true })).toHaveAttribute('href', roundPath(2));
    await expect(rounds.getByRole('link', { name: '← Regular season' })).toHaveAttribute('href', `/seasons/${fixture.hubSeasonId}`);

    await page.getByRole('link', { name: /^Group 1/ }).click();
  });

  await test.step('group page', async () => {
    await expectPath(page, groupPath(fixture.eliminationPodId));
    await assertNoErrorBoundary(page);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('Round 1');
    await expect(heading).toContainText('Group 1');
    await expect(heading.getByRole('link', { name: 'Round 1' })).toHaveAttribute('href', roundPath(1));
    await expect(page.getByText('Elimination', { exact: true })).toBeVisible();

    const groups = page.getByRole('navigation', { name: 'Groups' });
    await expect(groups.locator('[aria-current="page"]')).toHaveText('Group 1');
    await expect(groups.getByRole('link', { name: 'Group 2' })).toHaveAttribute('href', groupPath(fixture.wildcardPodId));
    // The final belongs to round 2, so round 1's strip does not list it.
    await expect(groups.getByRole('link', { name: 'Final' })).toHaveCount(0);

    // The elimination pod's scorecard: one player wins both games and advances.
    await expect(page.getByRole('columnheader', { name: 'Seed' })).toBeVisible();
    await expect(page.getByText('Advances', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Eliminated', { exact: true })).toHaveCount(3);
    for (const matchId of fixture.eliminationMatchIds) await expect(matchLink(page, matchId)).toBeVisible();
    for (const matchId of fixture.wildcardMatchIds) await expect(matchLink(page, matchId)).toHaveCount(0);

    await page.getByRole('link', { name: '← Regular season' }).click();
  });

  await test.step('back to the regular season', async () => {
    await expectPath(page, `/seasons/${fixture.hubSeasonId}`);
    await assertNoErrorBoundary(page);
  });
});

test('round page lists every group; carets collapse a group and titles link to its page', async ({ page }) => {
  await page.goto(roundPath(1));
  await assertNoErrorBoundary(page);

  // Two played groups and the unscheduled final, each a collapsible section with its own page link.
  await expect(page.getByRole('link', { name: /^Group 1/ })).toHaveAttribute('href', groupPath(fixture.eliminationPodId));
  await expect(page.getByRole('link', { name: /^Group 2/ })).toHaveAttribute('href', groupPath(fixture.wildcardPodId));
  await expect(page.getByText('Elimination', { exact: true })).toBeVisible();
  await expect(page.getByText('Wildcard', { exact: true })).toBeVisible();
  for (const matchId of [...fixture.eliminationMatchIds, ...fixture.wildcardMatchIds]) {
    await expect(matchLink(page, matchId)).toBeVisible();
  }
  // 1 + 3 players advance (elimination, wildcard) and 3 + 1 are out.
  await expect(page.getByText('Advances', { exact: true })).toHaveCount(4);
  await expect(page.getByText('Eliminated', { exact: true })).toHaveCount(4);

  // The caret toggles its own group only, and stays on the round page.
  const collapse = page.getByRole('button', { name: 'Collapse Group 1' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand Group 1' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  for (const matchId of fixture.eliminationMatchIds) await expect(matchLink(page, matchId)).toHaveCount(0);
  for (const matchId of fixture.wildcardMatchIds) await expect(matchLink(page, matchId)).toBeVisible();
  await expectPath(page, roundPath(1));

  await expand.click();
  for (const matchId of fixture.eliminationMatchIds) await expect(matchLink(page, matchId)).toBeVisible();

  // The title, unlike the caret, navigates.
  await page.getByRole('link', { name: /^Group 2/ }).click();
  await expectPath(page, groupPath(fixture.wildcardPodId));
  await assertNoErrorBoundary(page);
  await expect(page.getByText('Wildcard', { exact: true })).toBeVisible();
  await expect(page.getByText('Advances', { exact: true })).toHaveCount(3);
  await expect(page.getByText('Eliminated', { exact: true })).toHaveCount(1);
});

test('the final round is upcoming, with a final whose slots name where each player comes from', async ({ page }) => {
  await page.goto(roundPath(2));
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Round 2');
  await expect(page.getByText('Final round', { exact: true })).toBeVisible();
  await expect(page.getByText('Upcoming', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Rounds' }).locator('[aria-current="page"]')).toHaveText('2');
  await expect(page.getByRole('link', { name: /^Final/ })).toHaveAttribute('href', groupPath(fixture.finalPodId));

  await expect(page.getByText('Not yet scheduled', { exact: true })).toBeVisible();
  for (const label of [
    'Round 1 Group 1 Winner',
    'Best seed of Round 1 Group 2',
    '2nd-best seed of Round 1 Group 2',
    '3rd-best seed of Round 1 Group 2',
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  await page.goto(groupPath(fixture.finalPodId));
  await assertNoErrorBoundary(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Final');
  await expect(page.getByText('Round 1 Group 1 Winner', { exact: true })).toBeVisible();
  // Alone in its round: no chip strip, just the way back to the regular season.
  await expect(page.getByRole('navigation', { name: 'Groups' }).getByRole('link', { name: '← Regular season' })).toBeVisible();
});

test('ids that disagree with where a stage lives redirect to its canonical URL', async ({ page }) => {
  const cases: [string, string][] = [
    // A gauntlet's own id in the path -> the paired regular season (the hub).
    [`/seasons/${fixture.gauntletSeasonId}/rounds/1`, roundPath(1)],
    [`/seasons/${fixture.gauntletSeasonId}/groups/${fixture.eliminationPodId}`, groupPath(fixture.eliminationPodId)],
    [`/seasons/${fixture.gauntletSeasonId}/weeks/${fixture.hubWeekId}`, weekPath()],
    // A gauntlet round's `weeks` row has no week page; it is the round page.
    [`/seasons/${fixture.hubSeasonId}/weeks/${fixture.roundOneWeekId}`, roundPath(1)],
    [`/seasons/${fixture.gauntletSeasonId}/weeks/${fixture.roundOneWeekId}`, roundPath(1)],
  ];
  for (const [from, to] of cases) {
    await test.step(`${from} -> ${to}`, async () => {
      await page.goto(from);
      await expectPath(page, to);
      await assertNoErrorBoundary(page);
      await expect(page.getByText('Page not found')).toHaveCount(0);
    });
  }
});

test('a missing round, group or week is a 404 page, not the error boundary', async ({ page }) => {
  for (const path of [
    `/seasons/${fixture.hubSeasonId}/rounds/99`,
    `/seasons/${fixture.hubSeasonId}/groups/999999999`,
    `/seasons/${fixture.hubSeasonId}/weeks/999999999`,
  ]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByText('Page not found')).toBeVisible();
      await assertNoErrorBoundary(page);
    });
  }
});

test('each stage page carries its title in Open Graph metadata and a renderable preview image', async ({ page }) => {
  const season = `Season ${fixture.seasonNumber}`;
  const cases: { path: string; title: string }[] = [
    { path: weekPath(), title: `DGLS · ${season} · Week 1` },
    { path: roundPath(1), title: `DGLS · ${season} Gauntlet · Round 1` },
    { path: groupPath(fixture.eliminationPodId), title: `DGLS · ${season} Gauntlet · Round 1 · Group 1` },
  ];
  for (const { path, title } of cases) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
      const image = page.locator('meta[property="og:image"]');
      await expect(image).toHaveCount(1);
      // The tag's origin is the deployment's, not the test server's; the path is what to fetch.
      const url = new URL((await image.getAttribute('content')) ?? '');
      const response = await page.request.get(`${url.pathname}${url.search}`, { timeout: 55_000 });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    });
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('week, round and group pages fit the width and the deep breadcrumb collapses', async ({ page }) => {
    for (const path of [weekPath(), roundPath(1), groupPath(fixture.eliminationPodId)]) {
      await test.step(path, async () => {
        await page.goto(path);
        await assertNoErrorBoundary(page);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoHorizontalPageScroll(page);
      });
    }

    // On the group page the trail is DGLS / Seasons / Season / Gauntlet / Round / Group: below `sm`
    // only the root and the last two levels show.
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'DGLS' })).toBeVisible();
    await expect(breadcrumb.getByRole('link', { name: 'Round 1' })).toBeVisible();
    await expect(breadcrumb.getByText('Group 1')).toBeVisible();
    for (const name of ['Seasons', 'Gauntlet']) {
      // `includeHidden`: the links are in the DOM, just not displayed, and role queries skip those.
      const link = breadcrumb.getByRole('link', { name, exact: true, includeHidden: true });
      await expect(link).toHaveCount(1);
      await expect(link).toBeHidden();
    }

    // The chip strip wraps instead of widening the page.
    await page.goto(roundPath(1));
    await expect(page.getByRole('navigation', { name: 'Rounds' })).toBeVisible();
    await expectNoHorizontalPageScroll(page);
  });
});
