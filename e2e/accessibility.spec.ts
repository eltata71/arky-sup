import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';
import { accessTokenOf, hasBackendAccess } from './support/backend';
import { createInitiative, createProjectFor, uniqueSuffix } from './support/journeys';
import { CANONICAL_DIAGRAMS, CANONICAL_DOCUMENTS, seedArtifact } from './support/seedArtifacts';

/**
 * 13.0 — axe-core recorre las diez rutas protegidas y las vistas de artefacto.
 *
 * La línea base (`accessibility-baseline.json`) lista, por pantalla, los ids de
 * regla que hoy se incumplen, y **sólo puede encogerse**: una regla que no esté
 * en la lista falla, y una que ya no ocurre debe salir de ella (un defecto
 * arreglado que sigue en la lista es una excusa para el siguiente). `null`
 * significa «sin medir»: se registra en el informe y no falla, para que el
 * primer CI produzca las cifras en vez de inventarlas.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

const BASELINE_PATH = 'e2e/accessibility-baseline.json';
const REPORT_DIR = 'e2e-report';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Baseline = { pantallas: Record<string, string[] | null> };
const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const measured: Record<string, { reglas: string[]; nodos: Record<string, number> }> = {};

test.describe.configure({ mode: 'serial' });

test.describe('Accesibilidad — axe sobre el artefacto desplegado', () => {
  let projectId = '';
  let diagramId = '';
  let documentId = '';

  test.beforeEach(async ({ page }) => {
    await signInE2E(page);
  });

  test.afterAll(() => {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(`${REPORT_DIR}/accessibility-axe.json`, JSON.stringify({ pantallas: measured }, null, 2));
  });

  async function audit(page: import('@playwright/test').Page, name: string, path: string): Promise<void> {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const reglas = [...new Set(results.violations.map((violation) => violation.id))].sort();
    measured[name] = { reglas, nodos: Object.fromEntries(results.violations.map((v) => [v.id, v.nodes.length])) };
    const known = baseline.pantallas[name];
    if (known === undefined) throw new Error(`«${name}» no está en accessibility-baseline.json`);
    if (known === null) {
      console.log(`[a11y] ${name}: sin línea base; ${reglas.length} reglas → ${reglas.join(', ') || '—'}`);
      return;
    }
    expect(reglas.filter((id) => !known.includes(id)), `Reglas nuevas en «${name}»`).toEqual([]);
    expect(known.filter((id) => !reglas.includes(id)), `Reglas ya resueltas en «${name}»: quítalas de la línea base`).toEqual([]);
  }

  test('prepara un proyecto con un diagrama y un documento', async ({ page, request }) => {
    test.setTimeout(120_000);
    const initiativeId = await createInitiative(page, `Accesibilidad E2E ${uniqueSuffix()}`);
    projectId = await createProjectFor(page, request, initiativeId);
    const token = await accessTokenOf(page);
    diagramId = await seedArtifact(request, token, projectId, CANONICAL_DIAGRAMS[0]!);
    documentId = await seedArtifact(request, token, projectId, CANONICAL_DOCUMENTS[0]!);
  });

  const staticRoutes: [string, string][] = [
    ['dashboard', '/'], ['iniciativas', '/initiatives'], ['proyectos', '/projects'], ['oficina', '/office'],
    ['agentes', '/agents'], ['configuracion', '/settings'], ['formacion', '/training'],
  ];
  for (const [name, path] of staticRoutes) {
    test(`${name} (${path})`, async ({ page }) => { await audit(page, name, path); });
  }

  test('usuarios (/users)', async ({ page }) => { await audit(page, 'usuarios', '/users'); });
  test('espacio de trabajo', async ({ page }) => { await audit(page, 'espacio-de-trabajo', `/workspace/${projectId}`); });
  test('proceso SDD', async ({ page }) => { await audit(page, 'proceso-sdd', `/sdd-process/${projectId}`); });
  test('artefacto: diagrama', async ({ page }) => { await audit(page, 'artefacto-diagrama', `/workspace/${projectId}?artifact=${diagramId}`); });
  test('artefacto: documento', async ({ page }) => { await audit(page, 'artefacto-documento', `/workspace/${projectId}?artifact=${documentId}`); });
});
