import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ArkyPro end-to-end smoke tests.
 *
 * Scope (Recomendación 1):
 *  - One iPad-shaped project (`Mobile Safari` viewport) so we can validate
 *    the canvas / inspector UX on the touch target the product spec
 *    targets.
 *  - A desktop-shaped project for non-touch regressions.
 *
 * Run locally with:
 *   npx playwright install chromium webkit   # one-time, downloads browsers
 *   npx playwright test
 *
 * The dev server is started automatically via `webServer`. CI can opt out
 * by exporting `PLAYWRIGHT_REUSE_SERVER=1`.
 */
const PORT = 3000;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Each test gets a generous timeout — the diagram pipeline does ELK +
  // smart-fit + readability scoring and can take ~3s on first load.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // Trace on first retry so flaky failures surface a screenshot/timeline
    // without paying the cost on every successful run.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'ipad-safari',
      use: {
        ...devices['iPad Pro 11'],
        // The product spec explicitly targets iPad landscape for the
        // architect persona; portrait stays uncovered for now.
        viewport: { width: 1180, height: 820 },
      },
    },
  ],
  /*
   * The E2E suite runs against the production build, not the dev server.
   *
   * It used to run `npm run dev`, which meant the one gate whose job is to
   * check the deployed artefact was checking a Vite dev transform instead:
   * different chunking, no minification, none of the manual `manualChunks`
   * split, and `lazyWithRetry` — which exists because of a real chunk-load
   * failure on iPad Safari *after a deploy* — never exercised on the code
   * shape that fails. `vite preview` serves `dist/`, which is what Vercel
   * publishes.
   *
   * `npm run e2e` therefore needs a build first; the workflow builds in the
   * same job. For the fast inner loop, `PLAYWRIGHT_DEV_SERVER=1` restores the
   * old behaviour, and `PLAYWRIGHT_REUSE_SERVER=1` attaches to a server you
   * started yourself.
   */
  webServer: process.env.PLAYWRIGHT_REUSE_SERVER
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_DEV_SERVER
          ? 'npm run dev'
          : `npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
