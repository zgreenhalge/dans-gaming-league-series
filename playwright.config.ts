import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT ?? '3100';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// `next dev`, not `next build && next start`: the dev-mock auth providers (`dev-zach-mock`/
// `dev-dan-mock`, see `authOptions.js`) are gated behind `NODE_ENV === "development"` and don't
// exist in a production build — a real Steam OAuth round-trip isn't scriptable. See docs/e2e.md.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // `next dev` always runs in development mode (no NODE_ENV override needed) — that's what
    // gates the dev-mock auth providers on.
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
