import { expect, type Page } from '@playwright/test';
import { main } from './page';

/** Asserts the page rendered, not the app's error boundary. */
export async function assertNoErrorBoundary(page: Page): Promise<void> {
  await expect(main(page).getByText('Something went wrong')).toHaveCount(0);
}
