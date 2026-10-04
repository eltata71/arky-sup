import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';
import { FAKE_DOCUMENT_MARKER, REALISTIC_TIMING, fakeStreamingAiProvider, hasBackendAccess } from './support/backend';
import { createInitiative, createProjectFor, uniqueSuffix } from './support/journeys';

/**
 * Plan de clase mundial 10.0 — medir el recorrido de generación.
 *
 * La ola 10 promete que generar se sienta como ver trabajar a un equipo: fases
 * con palabras humanas, contenido que aparece mientras se escribe, y una
 * interfaz que no se bloquea. Antes de cambiar nada, esto mide lo que hay, con
 * un proveedor que tarda lo que tarda un modelo (`REALISTIC_TIMING`: primer
 * fragmento a 1,5 s y ocho fragmentos cada 0,4 s).
 *
 * Cuatro cifras, medidas **en la página** desde el clic en «Crear Artefacto»:
 *
 * - `primerIndicadorMs`: aparece algo que dice que se está trabajando.
 * - `primeraFaseMs`: aparece una fase con nombre. El contrato es un elemento
 *   con `data-generation-phase`; hoy no existe ninguno y la cifra es `null` —
 *   no se dice qué está pasando—. 10.1 y 10.2 lo cumplen.
 * - `primerContenidoMs`: el texto del documento aparece en pantalla.
 * - `finalMs`: la superposición se retira y el contenido está a la vista.
 *
 * Y si la interfaz responde mientras tanto: si la navegación del raíl recibe
 * un clic (`click({ trial: true })` comprueba que nada la tapa) y el peor
 * retraso del bucle de eventos.
 *
 * No falla por las cifras: es la línea base. El informe se escribe en
 * `e2e-report/` y el workflow lo publica como artefacto de CI.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

interface GenerationTimeline {
  primerIndicadorMs: number | null;
  primeraFaseMs: number | null;
  primerContenidoMs: number | null;
  finalMs: number | null;
  peorRetrasoBucleMs: number;
  tareasLargas: number;
  peorTareaLargaMs: number;
}

const REPORT_DIR = join(process.cwd(), 'e2e-report');

test('el recorrido de generación, medido', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInE2E(page);
  const ai = await fakeStreamingAiProvider(page);
  const initiativeId = await createInitiative(page, `Medición E2E ${uniqueSuffix()}`);
  const projectId = await createProjectFor(page, request, initiativeId);

  await page.goto(`/workspace/${projectId}`);
  await page.getByRole('button', { name: /Catálogo/ }).first().click();
  const createButton = page.getByRole('button', { name: /Crear Artefacto/ });
  const card = page.locator('div')
    .filter({ has: page.getByRole('heading', { level: 4, name: 'Visión de la Arquitectura', exact: true }) })
    .filter({ has: createButton })
    .last();

  // Los observadores se instalan antes del clic, en la página: el tiempo se
  // mide donde lo vive la persona, no en el proceso de la prueba.
  await page.evaluate((marker) => {
    const w = window as unknown as { __gen: Record<string, number | null>; __genStart: number };
    const t = () => Math.round(performance.now() - w.__genStart);
    w.__gen = { indicator: null, phase: null, content: null, final: null, lag: 0, longTasks: 0, worstLongTask: 0 };
    const overlay = () => document.querySelector('[role="dialog"][aria-label="Procesando"]');
    const contentVisible = () => {
      const o = overlay();
      return Array.from(document.querySelectorAll('main, [role="main"], body')).some((root) =>
        (root.textContent ?? '').includes(marker) && !(o && o.textContent?.includes(marker)));
    };
    const check = () => {
      const g = w.__gen;
      if (g.indicator === null && (overlay() || document.querySelector('[data-generation-phase]'))) g.indicator = t();
      if (g.phase === null && document.querySelector('[data-generation-phase]')) g.phase = t();
      if (g.content === null && contentVisible()) g.content = t();
      if (g.final === null && g.indicator !== null && !overlay() && contentVisible()) g.final = t();
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
    let expected = performance.now() + 50;
    setInterval(() => {
      const now = performance.now();
      w.__gen.lag = Math.max(w.__gen.lag ?? 0, Math.round(now - expected));
      expected = now + 50;
      check();
    }, 50);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__gen.longTasks = (w.__gen.longTasks ?? 0) + 1;
          w.__gen.worstLongTask = Math.max(w.__gen.worstLongTask ?? 0, Math.round(entry.duration));
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch { /* sin soporte de longtask: se informa 0 */ }
    w.__genStart = performance.now();
  }, FAKE_DOCUMENT_MARKER);
  await card.getByRole('button', { name: /Crear Artefacto/ }).click();

  // ¿Responde la navegación mientras se genera? Se pregunta en cuanto hay
  // indicador, y sólo si la generación no ha terminado ya.
  const progress = () => page.evaluate(() => (window as unknown as { __gen: { indicator: number | null; final: number | null } }).__gen);
  await expect.poll(async () => { const g = await progress(); return g.indicator !== null || g.final !== null; }, {
    timeout: 30_000, message: 'No apareció ningún indicador de que se estaba generando',
  }).toBe(true);
  const railLink = page.locator('aside[aria-label="Navegación principal"]').getByRole('button', { name: /Proyectos/ });
  const navegacionRespondeDuranteGeneracion = (await progress()).final === null
    ? await railLink.click({ trial: true, timeout: 1_000 }).then(() => true, () => false)
    : null;

  // 10.2 leaves the architect on the current screen. The finished card offers
  // the explicit transition to the canvas, so the timeline includes that tap.
  await page.getByRole('complementary', { name: 'Centro de generaciones' }).getByRole('button', { name: 'Abrir' }).click({ timeout: 150_000 });

  await expect.poll(() => page.evaluate(() => (window as unknown as { __gen: { final: number | null } }).__gen.final), {
    timeout: 150_000, message: 'La generación no terminó en pantalla',
  }).not.toBeNull();

  const raw = await page.evaluate(() => (window as unknown as { __gen: Record<string, number | null> }).__gen);
  const timeline: GenerationTimeline = {
    primerIndicadorMs: raw.indicator ?? null,
    primeraFaseMs: raw.phase ?? null,
    primerContenidoMs: raw.content ?? null,
    finalMs: raw.final ?? null,
    peorRetrasoBucleMs: raw.lag ?? 0,
    tareasLargas: raw.longTasks ?? 0,
    peorTareaLargaMs: raw.worstLongTask ?? 0,
  };
  const report = {
    fecha: new Date().toISOString(),
    proveedor: REALISTIC_TIMING,
    llamadasAlProveedor: await ai.calls(),
    ...timeline,
    navegacionRespondeDuranteGeneracion,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'generation-experience.json'), `${JSON.stringify(report, null, 2)}\n`);
  const ms = (value: number | null) => (value === null ? 'no se muestra' : `${(value / 1000).toFixed(2)} s`);
  writeFileSync(join(REPORT_DIR, 'generation-experience.md'), [
    '# Recorrido de generación (10.0)',
    '',
    `Proveedor simulado: primer fragmento a ${REALISTIC_TIMING.firstChunkMs} ms, ${REALISTIC_TIMING.chunks} fragmentos cada ${REALISTIC_TIMING.chunkMs} ms.`,
    '',
    '| Medida | Valor |',
    '|---|---|',
    `| Primer indicador | ${ms(timeline.primerIndicadorMs)} |`,
    `| Primera fase con nombre | ${ms(timeline.primeraFaseMs)} |`,
    `| Primer contenido visible | ${ms(timeline.primerContenidoMs)} |`,
    `| Final en pantalla | ${ms(timeline.finalMs)} |`,
    `| La navegación responde durante la generación | ${navegacionRespondeDuranteGeneracion === null ? 'sin medir (terminó antes)' : navegacionRespondeDuranteGeneracion ? 'sí' : 'no'} |`,
    `| Peor retraso del bucle de eventos | ${timeline.peorRetrasoBucleMs} ms |`,
    `| Tareas largas (>50 ms) | ${timeline.tareasLargas}, la peor de ${timeline.peorTareaLargaMs} ms |`,
    `| Llamadas al proveedor | ${report.llamadasAlProveedor} |`,
    '',
  ].join('\n'));
  await test.info().attach('generation-experience.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

  // Lo único que se afirma es que el recorrido se completó y pasó por el proveedor.
  expect(report.llamadasAlProveedor).toBeGreaterThan(0);
  expect(timeline.primerContenidoMs).not.toBeNull();
});

test('tres generaciones continúan al navegar', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInE2E(page);
  await fakeStreamingAiProvider(page);
  const initiativeId = await createInitiative(page, `Cola E2E ${uniqueSuffix()}`);
  const projectId = await createProjectFor(page, request, initiativeId);
  await page.goto(`/workspace/${projectId}`);
  await page.getByRole('button', { name: /Catálogo/ }).first().click();
  for (const name of ['Visión de la Arquitectura', 'Principios de Arquitectura', 'Análisis de Stakeholders']) {
    const card = page.locator('div').filter({ has: page.getByRole('heading', { level: 4, name, exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Crear Artefacto/ }) }).last();
    await card.getByRole('button', { name: /Crear Artefacto/ }).click();
    await page.getByRole('button', { name: 'Cerrar centro de generaciones' }).click();
  }
  await page.getByRole('button', { name: 'Abrir centro de generaciones' }).click();
  const center = page.getByRole('complementary', { name: 'Centro de generaciones' });
  await expect(center.getByRole('listitem')).toHaveCount(3);
  await page.locator('aside[aria-label="Navegación principal"]').getByRole('button', { name: /Proyectos/ }).click();
  await expect(page).toHaveURL('/projects');
  await expect(center.getByRole('listitem')).toHaveCount(3);
  await expect(center.getByRole('button', { name: 'Abrir' })).toHaveCount(3, { timeout: 150_000 });

});

test('cancelar una generación no persiste un artefacto', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInE2E(page);
  await fakeStreamingAiProvider(page);
  const initiativeId = await createInitiative(page, `Cancelación E2E ${uniqueSuffix()}`);
  const projectId = await createProjectFor(page, request, initiativeId);
  await page.goto(`/workspace/${projectId}`);
  await page.getByRole('button', { name: /Catálogo/ }).first().click();
  const card = page.locator('div').filter({ has: page.getByRole('heading', { level: 4, name: 'Visión de la Arquitectura', exact: true }) })
    .filter({ has: page.getByRole('button', { name: /Crear Artefacto/ }) }).last();
  await card.getByRole('button', { name: /Crear Artefacto/ }).click();
  const center = page.getByRole('complementary', { name: 'Centro de generaciones' });
  await center.getByRole('button', { name: 'Cancelar' }).click();
  await expect(center).toContainText('Cancelado');
  await page.waitForTimeout(REALISTIC_TIMING.firstChunkMs + REALISTIC_TIMING.chunks * REALISTIC_TIMING.chunkMs + 1000);
  await page.reload();
  await page.getByRole('button', { name: /Catálogo/ }).first().click();
  await expect(card.getByRole('button', { name: /Crear Artefacto/ })).toBeVisible();
});

test('una recarga informa los trabajos interrumpidos sin restaurar trabajos fantasma', async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInE2E(page);
  await fakeStreamingAiProvider(page);
  const initiativeId = await createInitiative(page, `Interrupción E2E ${uniqueSuffix()}`);
  const projectId = await createProjectFor(page, request, initiativeId);
  await page.goto(`/workspace/${projectId}`);
  await page.getByRole('button', { name: /Catálogo/ }).first().click();
  for (const name of ['Visión de la Arquitectura', 'Principios de Arquitectura']) {
    const card = page.locator('div').filter({ has: page.getByRole('heading', { level: 4, name, exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Crear Artefacto/ }) }).last();
    await card.getByRole('button', { name: /Crear Artefacto/ }).click();
    await page.getByRole('button', { name: 'Cerrar centro de generaciones' }).click();
  }
  await page.getByRole('button', { name: 'Abrir centro de generaciones' }).click();
  await expect(page.getByRole('complementary', { name: 'Centro de generaciones' }).getByRole('listitem')).toHaveCount(2);
  await page.reload();
  await expect(page.getByText('2 generaciones interrumpidas', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir centro de generaciones' }).click();
  await expect(page.getByRole('complementary', { name: 'Centro de generaciones' }).getByRole('listitem')).toHaveCount(0);
});
