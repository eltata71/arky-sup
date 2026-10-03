import { expect, test } from '@playwright/test';
import { E2E_PROJECTIONS, signInE2E } from './support/auth';
import { FAKE_DOCUMENT_MARKER, accessTokenOf, fakeAiProvider, hasBackendAccess, rpc } from './support/backend';
import { createInitiative, createProjectFor, uniqueSuffix, type StoredProject } from './support/journeys';

/**
 * F6-04 — Los dos flujos críticos que faltaban: un artefacto generado, y el
 * grafo que queda pendiente cuando nadie tiene la pestaña abierta.
 *
 *  1. **Generar un artefacto** recorre el camino entero del producto —hub,
 *     preflight, motor, transporte, guardas, `create_artifact`— con el
 *     proveedor sustituido detrás de `/api/ai`. Lo que se afirma se lee de la
 *     base, no de la pantalla: un artefacto que sólo vive en el estado de React
 *     de la pestaña que lo generó no está guardado.
 *  2. **La bitácora de proyecciones** (F5-04/F5-05). Un artefacto cambia
 *     mientras la aplicación está cerrada —otro dispositivo, una pestaña que se
 *     cerró antes del temporizador—. El pendiente lo escribe la base en la misma
 *     transacción, sin navegador; el siguiente arranque lo procesa. Era
 *     exactamente lo que el `setTimeout` de antes perdía sin dejar rastro.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

test.describe('Flujos críticos — generar un artefacto', () => {
  test.beforeEach(async ({ page }) => {
    await signInE2E(page);
  });

  test('un artefacto generado desde el catálogo queda guardado y sobrevive a la recarga', async ({ page, request }) => {
    test.setTimeout(180_000);
    const ai = await fakeAiProvider(page);
    const initiativeId = await createInitiative(page, `Visión E2E ${uniqueSuffix()}`);
    const projectId = await createProjectFor(page, request, initiativeId);

    await page.goto(`/workspace/${projectId}`);
    await page.getByRole('button', { name: /Catálogo/ }).first().click();
    // La tarjeta es el contenedor más interno que tiene a la vez el título y el
    // botón: el bloque del título no tiene el botón, y los de fuera van antes.
    const createButton = page.getByRole('button', { name: /Crear Artefacto/ });
    const card = page.locator('div')
      .filter({ has: page.getByRole('heading', { level: 4, name: 'Visión de la Arquitectura', exact: true }) })
      .filter({ has: createButton })
      .last();
    await card.getByRole('button', { name: /Crear Artefacto/ }).click();

    // Lo que cuenta es la base: el contenido del proveedor, guardado en el proyecto.
    const token = await accessTokenOf(page);
    await expect.poll(async () => {
      const project = await rpc<StoredProject>(request, token, 'load_project_aggregate', { p_id: projectId });
      return (project.artifacts ?? []).some((artifact) =>
        artifact.name === 'Visión de la Arquitectura' && artifact.content.includes(FAKE_DOCUMENT_MARKER));
    }, { timeout: 120_000, message: 'El artefacto generado no llegó a la base' }).toBe(true);
    expect(ai.calls(), 'La generación no pasó por /api/ai').toBeGreaterThan(0);

    await page.reload();
    await page.getByRole('button', { name: /Mis artefactos/ }).first().click();
    await expect(page.getByText('Visión de la Arquitectura').first()).toBeVisible({ timeout: 20_000 });
  });
});

interface PendingProjection { projectId: string; projection: string; generation: number }
interface StoredGraph { buildId?: string; revision?: number }

test.describe('Flujos críticos — la bitácora de proyecciones', () => {
  // Cuenta propia: cualquier otra pestaña de la misma cuenta procesaría el
  // pendiente al arrancar, y el aserto de que existe sería una carrera.
  test.beforeEach(async ({ page }) => {
    await signInE2E(page, E2E_PROJECTIONS);
  });

  test('un cambio con la aplicación cerrada deja un pendiente, y el siguiente arranque reconstruye el grafo', async ({ page, request }) => {
    test.setTimeout(120_000);
    const initiativeId = await createInitiative(page, `Proyección E2E ${uniqueSuffix()}`);
    const projectId = await createProjectFor(page, request, initiativeId);
    const token = await accessTokenOf(page);

    // La aplicación se cierra: desde aquí nadie tiene un temporizador en marcha.
    await page.goto('about:blank');

    // El proyecto ya tiene grafo —la bitácora sólo mantiene los que existen—.
    // Si la aplicación aún no había guardado uno, lo siembra esta prueba.
    const loadGraph = async (): Promise<StoredGraph | null> => {
      const response = await request.post(`${process.env.SUPABASE_URL}/rest/v1/rpc/load_knowledge_graph`, {
        headers: {
          apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'api',
          'Accept-Profile': 'api',
        },
        data: { p_project_id: projectId },
      });
      if (!response.ok()) return null;
      return (await response.json()) as StoredGraph;
    };
    let before = await loadGraph();
    if (!before) {
      await rpc(request, token, 'save_knowledge_graph', {
        p_project_id: projectId,
        p_graph: {
          projectId,
          buildId: `e2e-seed-${uniqueSuffix()}`,
          lastBuiltAt: new Date().toISOString(),
          entities: [],
          relations: [],
          quality: {},
          statistics: {},
        },
        p_expected_revision: 0,
      });
      before = await loadGraph();
    }
    expect(before, 'El grafo de partida no se pudo leer').not.toBeNull();

    // «Otro dispositivo» escribe un artefacto y lo corrige después.
    const artifactId = `e2e-art-${uniqueSuffix()}`;
    const created = await rpc<{ revision: number }>(request, token, 'create_artifact', {
      p_project_id: projectId,
      p_artifact: {
        id: artifactId,
        name: 'Principios de Arquitectura',
        type: 'markdown',
        versionGroupId: artifactId,
        version: 1,
        createdAt: new Date().toISOString(),
        phase: 'Fase 1: Estratégica y de Visión de Negocio',
        architecturalView: 'Vista de Contexto y Negocio',
        content: '# Principios de Arquitectura\n\n1. API-First.\n2. Zero Trust.\n',
        objective: 'Fijar los principios que guían las decisiones de arquitectura.',
        representation: 'document',
        keyConcepts: [{ term: 'API-First', definition: 'Las capacidades se publican primero como contrato.' }],
      },
    });
    await rpc(request, token, 'update_artifact', {
      p_artifact_id: artifactId,
      p_expected_revision: created.revision,
      p_patch: { content: '# Principios de Arquitectura\n\n1. API-First.\n2. Zero Trust.\n3. Observabilidad nativa.\n' },
    });

    // El pendiente existe sin que ningún navegador haya hecho nada: lo escribió
    // la transacción del artefacto.
    const pendingFor = async () =>
      (await rpc<PendingProjection[]>(request, token, 'list_pending_projections'))
        .filter((item) => item.projectId === projectId && item.projection === 'knowledge-graph');
    const pending = await pendingFor();
    expect(pending, 'La escritura del artefacto no dejó un pendiente').toHaveLength(1);

    // La aplicación vuelve a abrirse: el arranque procesa lo que quedó.
    await page.goto('/');
    await expect.poll(async () => (await pendingFor()).length, {
      timeout: 60_000,
      message: 'El arranque no procesó el pendiente',
    }).toBe(0);

    const after = await loadGraph();
    expect(after?.revision ?? 0).toBeGreaterThan(before?.revision ?? 0);
    expect(after?.buildId).not.toBe(before?.buildId);
  });
});
