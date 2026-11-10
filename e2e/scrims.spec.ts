/**
 * E2E coverage for scrim nights (`/scrims`, `/scrims/[id]`, `/scrims/matches/[id]`), through the real
 * UI: the calendar signed out and signed in, starting a night on a picked day, the overlap refusal,
 * signing up / switching / dropping out (the last player out removes the night), the night page's
 * status bar and Roster tab, the admin menus, checking in, Next Match (make, change the side, discard), Generate Rounds (preview,
 * Details, queue), a night on the home page's Upcoming panel, and a past night's results and match
 * page. Each test starts from no scrim nights
 * and seeds its own (`e2e/support/db.ts`); see docs/e2e.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAs, DEV_USER_PLAYER_ID } from './support/auth';
import {
  clearMapWorkshopUrls,
  scrimMatchesOf,
  scrimNightExists,
  scrimNightIdsStartingAt,
  seedScoredScrimMatch,
  seedScrimNight,
  setMapWorkshopUrls,
  teardownScrims,
} from './support/db';

const DAN = DEV_USER_PLAYER_ID.Dan;
// Seeded players besides Zach (1, admin) and Dan (7): Casey 2, Drew 3, Sam 4, Jordan 5, Riley 6.
const CASEY = 2;
const DREW = 3;
const SAM = 4;
const JORDAN = 5;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

test.beforeEach(async () => {
  await teardownScrims();
});

test.afterEach(async () => {
  await teardownScrims();
});

/** The viewer's calendar day `daysAhead` from now (`YYYY-MM-DD`), and the instant that day's `time`
 *  is — both in the browser's timezone, which is what the calendar and the start form use. */
async function browserDay(page: Page, daysAhead: number, time = '20:00'): Promise<{ day: string; startsAt: string }> {
  return page.evaluate(
    ([ahead, hhmm]) => {
      const d = new Date(Date.now() + (ahead as number) * 24 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return { day, startsAt: new Date(`${day}T${hhmm}`).toISOString() };
    },
    [daysAhead, time] as const,
  );
}

/** Logs in as `user`, then opens `path` once the server renders it signed in: the dev login updates
 *  the client session first, so a page loaded straight after can still render signed out. The
 *  signed-in mark is a night's own signup buttons (`Maybe` shows for any signed-in viewer). */
async function openNightAs(page: Page, user: 'Dan' | 'Zach', path: string): Promise<void> {
  await loginAs(page, user, '/maps');
  await expect(async () => {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Maybe', exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000, intervals: [1_000] });
}

/** `openNightAs()` for `/scrims`: signed in, the calendar's picked day offers the start form. */
async function openScrimsAs(page: Page, user: 'Dan' | 'Zach'): Promise<void> {
  await loginAs(page, user, '/maps');
  await expect(async () => {
    await page.goto('/scrims');
    await expect(page.getByText('Start a night this day')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000, intervals: [1_000] });
}

/** `day`'s calendar cell, once the calendar has mounted (it renders only in the browser), moving to
 *  the next month first when the day is in it. */
async function dayCell(page: Page, day: string) {
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  const cell = page.locator(`button[aria-label^="${day}"]`);
  if ((await cell.count()) === 0) await page.getByRole('button', { name: 'Next month' }).click();
  return cell;
}

/** Clicks `day`'s calendar cell. */
async function pickDay(page: Page, day: string): Promise<void> {
  await (await dayCell(page, day)).click();
}

test.describe('calendar and signups', () => {
  test('signed out, the calendar shows today with a login prompt instead of the start form', async ({ page }) => {
    await page.goto('/scrims');
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
    await expect(page.getByText('No scrims this day yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/api/auth/steam');
    await expect(page.getByText('Start a night this day')).toHaveCount(0);
  });

  test('a player starts a night on a picked day and lands on its page as the first signup', async ({ page }) => {
    await openScrimsAs(page, 'Dan');
    const { day, startsAt } = await browserDay(page, 2);
    await pickDay(page, day);

    await expect(page.getByText('Start a night this day')).toBeVisible();
    await page.getByLabel('Night start time').fill('20:00');
    await page.getByRole('button', { name: "I'm in" }).click();

    await expect(page).toHaveURL(/\/scrims\/\d+$/, { timeout: 30_000 });
    await expect(page.getByText('Definite · 1')).toBeVisible();
    await expect(page.getByRole('main').getByText('Dan', { exact: true }).first()).toBeVisible();
    expect(await scrimNightIdsStartingAt(startsAt)).toHaveLength(1);

    // The calendar day now shows the signup count, and the night's time links to its page.
    await page.goto('/scrims');
    const cell = await dayCell(page, day);
    await expect(cell).toHaveAttribute('aria-label', /1 definite, 0 maybe/);
    await cell.click();
    await page.getByRole('main').getByRole('link').filter({ hasText: /\d:\d\d/ }).first().click();
    await expect(page).toHaveURL(/\/scrims\/\d+$/);
  });

  test('starting a night that overlaps another is refused', async ({ page }) => {
    await page.goto('/scrims');
    const existing = await browserDay(page, 2, '21:00');
    await seedScrimNight(existing.startsAt, [{ playerId: CASEY }]);

    await openScrimsAs(page, 'Dan');
    await pickDay(page, existing.day);
    await page.getByLabel('Night start time').fill('20:00');
    await page.getByRole('button', { name: "I'm in" }).click();
    await expect(page.getByText(/Another scrim night overlaps that time/)).toBeVisible();
  });

  test('switching to maybe, then dropping out as the last player, removes the night', async ({ page }) => {
    const nightId = await seedScrimNight(2 * DAY, [{ playerId: DAN }]);
    await openNightAs(page, 'Dan', `/scrims/${nightId}`);

    await page.getByRole('button', { name: 'Maybe', exact: true }).click();
    await expect(page.getByText('Maybe · 1')).toBeVisible();
    await expect(page.getByText('Definite · 0')).toBeVisible();

    await page.getByRole('button', { name: 'Drop out' }).click();
    await expect(page).toHaveURL(/\/scrims$/, { timeout: 30_000 });
    expect(await scrimNightExists(nightId)).toBe(false);
  });

  test('joining and then leaving a night others are in keeps it', async ({ page }) => {
    const nightId = await seedScrimNight(2 * DAY, [{ playerId: CASEY }]);
    await openNightAs(page, 'Dan', `/scrims/${nightId}`);

    await page.getByRole('button', { name: 'Definite', exact: true }).click();
    await expect(page.getByText('Definite · 2')).toBeVisible();
    await page.getByRole('button', { name: 'Drop out' }).click();
    await expect(page.getByText('Definite · 1')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/scrims/${nightId}$`));
    expect(await scrimNightExists(nightId)).toBe(true);
  });

  test("an upcoming night's page has the status bar over a Roster tab, and a stale ?tab= link opens on it", async ({ page }) => {
    const nightId = await seedScrimNight(2 * DAY, [{ playerId: CASEY }, { playerId: DREW, commitment: 'maybe' }]);
    await page.goto(`/scrims/${nightId}?tab=lobby`);
    const main = page.getByRole('main');
    await expect(main.getByText('Upcoming', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roster' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Lobby' })).toHaveCount(0);
    await expect(page.getByText('Definite · 1')).toBeVisible();
    await expect(page.getByText('Maybe · 1')).toBeVisible();
    // Signed out, and check-in isn't open yet: no commitment or Check in.
    await expect(page.getByRole('button', { name: 'Maybe', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);

    await openNightAs(page, 'Dan', `/scrims/${nightId}`);
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);
  });

  test('an admin adds a player from the Attendance menu and removes one from their row; a non-admin has no menus', async ({ page }) => {
    const nightId = await seedScrimNight(2 * DAY, [{ playerId: CASEY }]);

    await openNightAs(page, 'Dan', `/scrims/${nightId}`);
    await expect(page.getByText('Definite · 1')).toBeVisible();
    await expect(page.getByRole('button', { name: /admin actions/i })).toHaveCount(0);

    await openNightAs(page, 'Zach', `/scrims/${nightId}`);
    const nightMenu = page.getByRole('button', { name: 'Attendance admin actions' });
    await expect(nightMenu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Sign up a player…')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toHaveCount(0);

    await nightMenu.click();
    await page.getByRole('menuitem', { name: 'Add player…' }).click();
    await page.getByLabel('Sign up a player…').selectOption({ label: 'Drew' });
    await page.getByRole('button', { name: 'Add as maybe' }).click();
    await expect(page.getByText('Maybe · 1')).toBeVisible();
    await expect(page.getByRole('main').getByText('Drew', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Admin actions for Drew' }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(page.getByText('Maybe · 0')).toBeVisible();
  });
});

test.describe('the lobby', () => {
  test.beforeEach(async () => {
    await setMapWorkshopUrls();
  });

  test.afterEach(async () => {
    await clearMapWorkshopUrls();
  });

  test('checking in, then Next Match makes a match shown to the player as a card; an admin saves its side choice and discards it', async ({ page }) => {
    const nightId = await seedScrimNight(10 * MINUTE, [
      { playerId: CASEY, checkedIn: true },
      { playerId: DREW, checkedIn: true },
      { playerId: SAM, checkedIn: true },
      { playerId: DAN },
    ]);
    await openNightAs(page, 'Dan', `/scrims/${nightId}`);

    await expect(page.getByText('3 checked in', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByText('4 checked in', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Next Match' }).click();
    await expect(page.getByRole('link', { name: /Match 1/ })).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Starting side')).toHaveCount(0);
    const [match] = await scrimMatchesOf(nightId);
    expect(match.players.sort((a, b) => a - b)).toEqual([CASEY, DREW, SAM, DAN].sort((a, b) => a - b));
    expect(match.scrim_side_choice).toBe('knife');

    await openNightAs(page, 'Zach', `/scrims/${nightId}`);
    const configure = page.getByText('Configure', { exact: true });
    await expect(page.getByLabel('Starting side')).toBeHidden();
    await configure.click();
    await page.getByLabel('Starting side').selectOption('random');
    await expect.poll(async () => (await scrimMatchesOf(nightId))[0]?.scrim_side_choice).toBe('random');
    await page.reload();
    await page.getByText('Configure', { exact: true }).click();
    await expect(page.getByLabel('Starting side')).toHaveValue('random');

    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByRole('button', { name: 'Confirm discard' }).click();
    await expect(page.getByRole('button', { name: 'Next Match' })).toBeVisible();
    expect(await scrimMatchesOf(nightId)).toHaveLength(0);
  });

  test("with nobody checked in there is no lobby; the status bar's Check in opens it", async ({ page }) => {
    const nightId = await seedScrimNight(10 * MINUTE, [{ playerId: CASEY }]);
    await openNightAs(page, 'Dan', `/scrims/${nightId}`);
    await expect(page.getByRole('tab', { name: 'Lobby' })).toHaveCount(0);
    await expect(page.getByText('0 checked in', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Lobby' })).toBeVisible();
    await expect(page.getByText('1 checked in', { exact: true })).toBeVisible();
    // Checking in signed Dan up, so the Roster tab lists him.
    await page.getByRole('tab', { name: 'Roster' }).click();
    await expect(page.getByText('Definite · 2')).toBeVisible();
  });

  test('a player who has not checked in can check in but not make matches; signed out sees only the count', async ({ page }) => {
    const nightId = await seedScrimNight(10 * MINUTE, [
      { playerId: CASEY, checkedIn: true },
      { playerId: DREW, checkedIn: true },
      { playerId: SAM, checkedIn: true },
      { playerId: JORDAN, checkedIn: true },
    ]);

    await page.goto(`/scrims/${nightId}`);
    await expect(page.getByText('4 checked in', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next Match' })).toHaveCount(0);

    await openNightAs(page, 'Dan', `/scrims/${nightId}`);
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next Match' })).toHaveCount(0);
  });

  test('Generate Rounds previews matchups with Details folded away, then queues them behind the lobby', async ({ page }) => {
    const nightId = await seedScrimNight(10 * MINUTE, [
      { playerId: CASEY, checkedIn: true },
      { playerId: DREW, checkedIn: true },
      { playerId: SAM, checkedIn: true },
      { playerId: DAN, checkedIn: true },
    ]);
    await openNightAs(page, 'Dan', `/scrims/${nightId}`);

    await expect(page.getByRole('button', { name: 'Next Match' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate Rounds' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();

    await expect(page.getByText('Matchups', { exact: true })).toBeVisible({ timeout: 30_000 });
    const gamesEach = page.getByText('Games each', { exact: true });
    await expect(gamesEach).toBeHidden();
    await page.getByText('Details', { exact: true }).click();
    await expect(gamesEach).toBeVisible();

    const queue = page.getByRole('button', { name: /Queue these \d+ matches/ });
    const count = Number((await queue.textContent())?.match(/\d+/)?.[0]);
    expect(count).toBeGreaterThan(0);
    await queue.click();

    await expect(page.getByRole('link', { name: /Match 1/ })).toBeVisible({ timeout: 30_000 });
    if (count > 1) await expect(page.getByText(`Up next · ${count - 1}`)).toBeVisible();
    const matches = await scrimMatchesOf(nightId);
    expect(matches.map((m) => m.match_number)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
  });
});

test("an upcoming night joins the home page's Upcoming panel, linking to its night page", async ({ page }) => {
  const nightId = await seedScrimNight(2 * DAY, [{ playerId: CASEY }, { playerId: DREW, commitment: 'maybe' }]);
  await page.goto('/');
  const row = page.getByRole('main').locator(`a[href="/scrims/${nightId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Scrim night');
  await expect(row).toContainText('1 in · 1 maybe');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/scrims/${nightId}$`), { timeout: 30_000 });
});

test('a past night lists under Past nights, with its leaderboard and a working match page', async ({ page }) => {
  const nightId = await seedScrimNight(-6 * 60 * MINUTE, [{ playerId: CASEY }, { playerId: DREW }, { playerId: SAM }, { playerId: JORDAN }]);
  const matchId = await seedScoredScrimMatch(nightId, [CASEY, DREW, SAM, JORDAN]);

  await page.goto('/scrims');
  await page.getByRole('link', { name: /1 match · 4 players/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/scrims/${nightId}$`));
  await expect(page.getByRole('main').getByText('Final', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('main').getByText('Leaderboard', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Casey').first()).toBeVisible();
  // Attendance comes last once the night is over, read-only.
  await page.getByRole('tab', { name: 'Roster' }).click();
  await expect(page.getByText('Definite · 4')).toBeVisible();

  // A league match URL for a scrim match redirects to its scrim page.
  await page.goto(`/matches/${matchId}`);
  await expect(page).toHaveURL(new RegExp(`/scrims/matches/${matchId}$`), { timeout: 30_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
