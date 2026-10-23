import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { E2E_AGENTS, signInE2E } from './support/auth';
import { accessTokenOf, fakeAiProvider, hasBackendAccess, rpc } from './support/backend';
import { createInitiative, uniqueSuffix } from './support/journeys';

/**
 * E2E — los agentes, de la ficha al prompt (plan de agentes 20.3).
 *
 * Lo que se afirma es lo que el producto promete y ninguna prueba unitaria ve
 * junta: que lo que una organización enseña a un agente en su ficha **llega al
 * prompt que sale hacia el proveedor**, una sola vez y dentro de la valla de
 * contenido ajeno; que un agente desactivado deja de convocarse; y que
 * restaurar sus valores de fábrica lo devuelve a como lo entrega el producto.
 *
 * Sólo se sustituye al proveedor (`/api/ai`): el dock, el motor, el transporte
 * y las guardas son los reales. Los prompts se leen **en la red**, no en el
 * estado de React.
 *
 * Cuenta propia (`agents@arky.e2e`): las fichas son por usuario, y con una
 * cuenta compartida cualquier otra prueba que convocara a Elena en paralelo
 * vería el marcador.
 *
 * No cubierto aquí, y dicho: el encargo con un revisor que devuelve JSON roto.
 * Desde 17.1 esa revisión no dice «no disponible»: se aprueba con
 * `basis: 'evidence-only'` y espera la firma de una persona. Esa regla la
 * sostienen `OfficeEngagementRunner.test.ts`, `reviewCritique.test.ts`,
 * `EvidenceReviewConfirm.test.tsx` y la familia de revisión del banco
 * (`npm run eval:agents`); correr un encargo entero con dos firmas en el
 * navegador sólo repetiría esas pruebas con más piezas que pueden fallar.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

const FENCE_OPEN = '<<<CONTENIDO_EXTERNO';
const FENCE_CLOSE = 'FIN_CONTENIDO_EXTERNO>>>';
const REQUEST = 'Revisa la seguridad de la API de pólizas y dime los riesgos principales.';

interface CapturedCall {
  system: string;
  user: string;
}

/** Registra cada petición al proveedor y la deja pasar al proveedor simulado. */
async function captureProviderCalls(page: Page): Promise<{ calls: CapturedCall[]; reset: () => void }> {
  await fakeAiProvider(page);
  const calls: CapturedCall[] = [];
  // Registrado después que el simulado: Playwright prueba primero el último, y
  // `fallback()` le pasa la petición al anterior.
  await page.route('**/api/ai', async (route: Route) => {
    try {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      calls.push({
        system: typeof body.systemInstruction === 'string' ? body.systemInstruction : '',
        user: JSON.stringify(body.prompt ?? body.contents ?? ''),
      });
    } catch {
      /* una petición ilegible no es el objeto de esta prueba */
    }
    await route.fallback();
  });
  return { calls, reset: () => { calls.length = 0; } };
}

/** El editor, no el cajón de la ficha que queda abierto detrás al guardar. */
function editorOf(page: Page) {
  return page.locator('[role="dialog"][aria-labelledby="agent-profile-title"]');
}

async function openElenaEditor(page: Page): Promise<void> {
  await page.goto('/agents');
  await page.getByRole('button', { name: /Ver la ficha de Elena/ }).first().click();
  await page.getByRole('button', { name: 'Configurar ficha' }).click();
  await expect(editorOf(page)).toBeVisible({ timeout: 15_000 });
}

async function askTheTeam(page: Page, initiativeTitle: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`Abrir el equipo de arquitectura para ${initiativeTitle}`) }).click();
  const box = page.getByRole('textbox', { name: 'Solicitud para el equipo de arquitectura' });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(REQUEST);
  await box.press('Enter');
  // Con 4 especialistas la Oficina pide aprobar el plan antes de gastar (20.2);
  // con menos no lo pide, así que el clic es condicional.
  const approve = page.getByRole('button', { name: 'Aprobar y empezar' });
  await approve.click({ timeout: 10_000 }).catch(() => undefined);
}

test.describe('Agentes — de la ficha al prompt', () => {
  test.beforeEach(async ({ page }) => {
    await signInE2E(page, E2E_AGENTS);
  });

  test('el conocimiento de la ficha llega una vez y vallado; apagar al agente lo saca del equipo', async ({ page, request }) => {
    test.setTimeout(240_000);
    const marker = `MARCADOR-E2E-${uniqueSuffix()}`;
    const { calls, reset } = await captureProviderCalls(page);

    // 1. Se enseña algo a Elena y se guarda: lo afirma la base, no la pantalla.
    await openElenaEditor(page);
    const dialog = editorOf(page);
    await dialog.getByLabel('Conocimiento de la organización').fill(marker);
    await dialog.getByLabel('Conocimiento de la organización').press('Enter');
    await dialog.getByRole('button', { name: 'Guardar ficha' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const token = await accessTokenOf(page);
    await expect.poll(async () => {
      const stored = await rpc<{ agentId: string; knowledge?: string[] }[]>(request, token, 'list_agent_profiles');
      return stored.find((entry) => entry.agentId === 'elena')?.knowledge?.includes(marker) ?? false;
    }, { timeout: 15_000, message: 'La ficha de Elena no llegó a la base' }).toBe(true);

    // 2. Se le pide algo al equipo desde una iniciativa.
    const title = `Agentes E2E ${uniqueSuffix()}`;
    const initiativeId = await createInitiative(page, title);
    reset();
    await askTheTeam(page, title);
    await expect.poll(() => calls.some((call) => call.system.includes(marker)), {
      timeout: 60_000,
      message: 'Ningún prompt llevó el conocimiento de la ficha de Elena',
    }).toBe(true);

    // 3. Llega una vez por prompt y dentro de la valla de contenido ajeno.
    const carrying = calls.filter((call) => call.system.includes(marker));
    for (const call of carrying) {
      expect(call.system.split(marker).length - 1, 'el marcador aparece más de una vez en un prompt').toBe(1);
      const open = call.system.indexOf(FENCE_OPEN);
      const at = call.system.indexOf(marker);
      const close = call.system.indexOf(FENCE_CLOSE, at);
      expect(open, 'el marcador no está dentro de una valla').toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThan(at);
      expect(close).toBeGreaterThan(at);
    }

    // 4. Accesibilidad del dock abierto: nada crítico.
    const dock = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    console.log(`[a11y] dock de agentes: ${dock.violations.map((violation) => `${violation.id}(${violation.impact})`).join(', ') || '—'}`);
    expect(dock.violations.filter((violation) => violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
    await page.waitForTimeout(500);

    // 5. Se apaga a Elena: la siguiente solicitud ya no la convoca.
    await openElenaEditor(page);
    const second = editorOf(page);
    await second.getByLabel('Disponible para la Oficina').uncheck();
    await second.getByRole('button', { name: 'Guardar ficha' }).click();
    await expect(second).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => {
      const stored = await rpc<{ agentId: string; enabled?: boolean }[]>(request, token, 'list_agent_profiles');
      return stored.find((entry) => entry.agentId === 'elena')?.enabled;
    }, { timeout: 15_000, message: 'Apagar a Elena no llegó a la base' }).toBe(false);

    await page.goto(`/initiatives/${initiativeId}`);
    reset();
    await askTheTeam(page, title);
    // Esperar a que el equipo trabaje (alguna llamada) y comprobar que ninguna
    // lleva a Elena.
    await expect.poll(() => calls.length, { timeout: 60_000, message: 'El equipo no hizo ninguna llamada' }).toBeGreaterThan(0);
    expect(calls.some((call) => call.system.includes(marker)), 'Elena apagada sigue recibiendo trabajo').toBe(false);

    // 6. Se restauran sus valores de fábrica: la ficha desaparece de la base.
    await openElenaEditor(page);
    await editorOf(page).getByRole('button', { name: 'Restaurar valores de fábrica' }).click();
    await expect.poll(async () => {
      const stored = await rpc<{ agentId: string }[]>(request, token, 'list_agent_profiles');
      return stored.some((entry) => entry.agentId === 'elena');
    }, { timeout: 15_000, message: 'Restaurar los valores de fábrica no borró la ficha' }).toBe(false);
  });

  test('/agents no tiene violaciones críticas de accesibilidad y su panel de calidad dice «sin medir»', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('heading', { level: 2, name: /Cómo trabajan/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sin medir/).first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    console.log(`[a11y] /agents con panel de calidad: ${results.violations.map((violation) => `${violation.id}(${violation.impact})`).join(', ') || '—'}`);
    expect(results.violations.filter((violation) => violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  });
});
