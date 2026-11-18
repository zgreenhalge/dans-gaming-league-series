import type { Page } from '@playwright/test';

/** The page's visible `<main>`: text, label and count locators go through it, since just after a load
 *  React can still hold a hidden copy of a streamed section beside the visible one (docs/e2e.md,
 *  "Locators"). `getByRole` skips hidden elements, so the scope is the visible copy. */
export function main(page: Page) {
  return page.getByRole('main');
}
