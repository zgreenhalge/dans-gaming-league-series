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
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A Chromium binary to use instead of the build the pinned @playwright/test downloads — for a
        // machine whose browser is pre-installed and can't run `npx playwright install`.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    // `next dev` always runs in development mode (no NODE_ENV override needed) — that's what
    // gates the dev-mock auth providers on.
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    // The dev-mock sign-in needs a fixed NextAuth secret (a random one breaks the session cookie
    // across recompiles) and NEXTAUTH_URL on the test origin — the values ci.yml's e2e job sets,
    // used here unless the shell sets its own.
    env: {
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'e2e-test-secret-do-not-use-in-prod',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseURL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
