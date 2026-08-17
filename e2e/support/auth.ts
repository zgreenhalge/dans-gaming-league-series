import { expect, type Page } from '@playwright/test';

/** The `dev-zach-mock`/`dev-dan-mock` dropdown entries, as rendered by `TopbarShell.tsx`'s
 *  `DevToggle` — the only scriptable login path outside a real Steam OAuth round-trip. Zach (player
 *  id 1) is the seeded admin; Dan (player id 7) is not. */
export const DEV_USER_PLAYER_ID = { Zach: 1, Dan: 7 } as const;
export type DevUser = keyof typeof DEV_USER_PLAYER_ID;

/** Logs in as one of the dev-mode mock users via the topbar's "dev" dropdown (development-only —
 *  see `playwright.config.ts`'s `webServer` comment for why the target server must be `next dev`).
 *  Navigates to `path` first so the topbar is present, then waits for the player's own avatar link
 *  to confirm the session actually landed before returning. */
export async function loginAs(page: Page, user: DevUser, path = '/'): Promise<void> {
  await page.goto(path);
  await page.getByRole('button', { name: 'dev', exact: true }).click();
  await page.getByRole('button', { name: user, exact: true }).click();
  await expect(page.locator(`a[href="/players/${DEV_USER_PLAYER_ID[user]}"]`)).toBeVisible();
}
