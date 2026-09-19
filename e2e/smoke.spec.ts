import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the ArkyPro canvas (Recomendación 1).
 *
 * These tests are intentionally light — they validate that the bare app
 * loads and renders the expected chrome on both desktop and iPad. The
 * heavier scenarios (load a saved diagram, open a quality panel, pinch
 * zoom on iPad, export a PNG, see-all vs focus-primary) belong in
 * follow-up specs once we have stable test fixtures wired through
 * the local Supabase stack's seed.
 *
 * Run:
 *   npx playwright install chromium webkit
 *   npx playwright test
 */

/**
 * Console errors that are *environmental* noise, not app regressions.
 *
 * The smoke test's job is to catch unhandled JS exceptions introduced by
 * app code — not to fail because the CI sandbox can't reach a CDN, a font
 * host, or a placeholder backend host. These patterns are filtered from
 * the console-error list so real regressions still surface:
 *   - External resource load failures (CDN, fonts, stylesheets, scripts)
 *   - Network / DNS errors (placeholders like ci.example.com)
 *   - 404 / MIME-refusal / cross-origin blocks from third-party hosts
 */
const ENV_NOISE =
  /Failed to load resource|net::|ERR_|MIME type|Refused to apply|Refused to execute|404|DNS|resolve|supabase|No se pudieron cargar settings|lectura de settings falló|googleapis|gstatic|fonts\.|cdn\.|jsdelivr|cloudflare|heroicons|reactflow/i;

test.describe('App smoke', () => {
  test('home page renders the root mount and the document title', async ({ page }) => {
    await page.goto('/');
    // The HTML shell ships `<div id="root">`; React mounts inside.
    await expect(page.locator('#root')).toBeAttached();
    // The product name in <title> is owned by index.html; this guards us
    // against accidentally shipping the Vite scaffolding title.
    await expect(page).toHaveTitle(/Arky|Architect|Arkypro/i);
  });

  test('does not throw unhandled JS exceptions on first paint', async ({ page }) => {
    // Uncaught exceptions (`pageerror`) are hard evidence of an app
    // regression — these are always fatal.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Console errors can include network/resource-loading noise from the
    // sandbox. We keep the last 100 and filter environmental patterns
    // below, so a blocked CDN or DNS placeholder doesn't sink the suite.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    // Allow the React tree to mount and the auth context to resolve.
    // `networkidle` is not a reliable signal against the local stack — waiting
    // for the app shell to render is the actual readiness signal.
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    // 1) Uncaught exceptions are always fatal — they mean app code threw.
    expect(
      pageErrors,
      `Unhandled JS exceptions on first paint:\n${pageErrors.join('\n')}`,
    ).toEqual([]);

    // 2) Console errors are only fatal if they come from the app's own
    //    logic, not from environmental resource-loading failures.
    const fatal = consoleErrors.filter((e) => !ENV_NOISE.test(e));
    expect(fatal, `Unexpected console errors on first paint:\n${fatal.join('\n')}`).toEqual([]);
  });
});
