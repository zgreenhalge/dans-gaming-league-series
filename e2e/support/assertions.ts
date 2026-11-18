import { expect, type Page } from '@playwright/test';

/** Asserts the page rendered, not the app's error boundary. */
export async function assertNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}
