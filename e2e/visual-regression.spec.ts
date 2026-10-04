import { existsSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';
import { accessTokenOf, hasBackendAccess } from './support/backend';
import { createInitiative, createProjectFor, uniqueSuffix } from './support/journeys';
import { CANONICAL_DIAGRAMS, CANONICAL_DOCUMENTS, seedArtifact, type SeedSpec } from './support/seedArtifacts';

/**
 * 13.0 — Regresión visual de seis diagramas y tres documentos canónicos contra
 * `dist/`, sólo en Chromium de escritorio. La tolerancia se declara aquí y no se
 * ensancha para que pase: un 2 % de píxeles absorbe el antialiasing de la
 * fuente, no un nodo movido.
 *
 * Sin imagen de referencia el caso **no falla**: guarda el candidato en
 * `e2e-report/visual-candidates/` (que el CI publica) para revisarlo y
 * confirmarlo en el repositorio. Una referencia que nadie miró no es una línea base.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Regresión visual: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

const TOLERANCE = { maxDiffPixelRatio: 0.02, threshold: 0.2 } as const;
const CANDIDATES = 'e2e-report/visual-candidates';

test.describe.configure({ mode: 'serial' });

test.describe('Regresión visual — diagramas y documentos canónicos', () => {
  let projectId = '';
  const ids = new Map<string, string>();
  const specs: readonly SeedSpec[] = [...CANONICAL_DIAGRAMS, ...CANONICAL_DOCUMENTS];

  test('prepara el proyecto y siembra los nueve artefactos', async ({ page, request }) => {
    test.setTimeout(180_000);
    await signInE2E(page);
    const initiativeId = await createInitiative(page, `Visual E2E ${uniqueSuffix()}`);
    projectId = await createProjectFor(page, request, initiativeId);
    const token = await accessTokenOf(page);
    for (const spec of specs) ids.set(spec.key, await seedArtifact(request, token, projectId, spec));
  });

  for (const spec of specs) {
    test(spec.name, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await signInE2E(page);
      await page.goto(`/workspace/${projectId}?artifact=${ids.get(spec.key)}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('main').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(2_500); // el layout del diagrama termina de asentarse
      const file = `${spec.key}.png`;
      if (!existsSync(testInfo.snapshotPath(file))) {
        mkdirSync(CANDIDATES, { recursive: true });
        await page.screenshot({ path: `${CANDIDATES}/${file}`, animations: 'disabled' });
        console.log(`[visual] ${spec.key}: sin referencia; candidato guardado`);
        return;
      }
      await expect(page).toHaveScreenshot(file, { ...TOLERANCE, animations: 'disabled', fullPage: false });
    });
  }
});
