import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * F6-05 — Every chunk of the build downloads **and evaluates**.
 *
 * On 2026-09-25 the Workspace route was down in production and every gate was
 * green. The chunk downloaded with a 200; it threw while evaluating —
 * `Cannot access 'Pk' before initialization`, an import cycle inside
 * `services/review` that only the production bundle's module order exposed.
 * Unit tests evaluate each file on its own, and no journey opened that route.
 *
 * Opening every route would test what the journeys test. This imports every
 * chunk the build emitted, in the browser, against the same `vite preview` of
 * `dist/` the journeys use, and fails on any that throws. It needs no session:
 * evaluating a module is independent of who is signed in.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Una vez basta: la evaluación no depende del viewport.');

const ASSETS = join(process.cwd(), 'dist', 'assets');

test('todos los chunks del build se descargan y se evalúan sin error', async ({ page }) => {
  test.setTimeout(180_000);
  const chunks = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
  expect(chunks.length, 'dist/assets vacío: ¿se construyó antes de la prueba?').toBeGreaterThan(10);

  await page.goto('/auth');
  const failures = await page.evaluate(async (names: string[]) => {
    const failed: string[] = [];
    for (const name of names) {
      try {
        await import(/* @vite-ignore */ `/assets/${name}`);
      } catch (error) {
        failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return failed;
  }, chunks);

  expect(failures, `${failures.length} de ${chunks.length} chunks fallaron al evaluarse`).toEqual([]);
});
