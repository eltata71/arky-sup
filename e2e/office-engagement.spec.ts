import { expect, test } from '@playwright/test';
import { E2E_ARCHITECT, E2E_REVIEWER, signInE2E } from './support/auth';

/**
 * E2E — Oficina de Arquitectura Empresarial.
 *
 * Este archivo separa la protección de rutas del flujo autenticado. Ambos
 * bloques corren siempre en CI contra el stack local de Supabase, efímero por construcción.
 *
 *  1. **Sin autenticación** (corre siempre): las rutas de la Oficina están
 *     protegidas y su chunk carga sin excepciones.
 *
 *  2. **Con autenticación, como autor**: el flujo real recepción (Nuevo
 *     entregable) → charter con productor y revisor distintos, contra el stack
 *     local de Supabase. Los selectores ejercen la UI que existe — el
 *     wizard real es EngagementIntakeWizard, con su título "Nuevo entregable".
 *
 *  3. **Con autenticación, como comité**: la firma de la decisión, en otra
 *     sesión. Son dos sesiones y no dos pestañas de la misma porque la
 *     separación autor/aprobador es la regla que el bloque prueba.
 */

const ENV_NOISE =
  /Failed to load resource|net::|ERR_|MIME type|Refused to apply|Refused to execute|404|DNS|resolve|supabase|No se pudieron cargar settings|lectura de settings falló|googleapis|gstatic|fonts\.|cdn\.|jsdelivr|cloudflare|heroicons|reactflow/i;

test.describe('Oficina de Arquitectura — acceso', () => {
  // `networkidle` no es una señal fiable aquí: el stack local mantiene
  // peticiones en vuelo, así que la aserción de URL (con reintento) es la espera.
  test('las rutas de la Oficina exigen sesión', async ({ page }) => {
    await page.goto('/office');
    // `ProtectedRoute` manda a /auth cuando no hay usuario.
    await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 });
  });

  test('la sala del encargo también está protegida', async ({ page }) => {
    await page.goto('/office/eng_no-existe');
    await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 });
  });

  test('cargar la ruta de la Oficina no lanza excepciones', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !ENV_NOISE.test(message.text())) {
        consoleErrors.push(message.text());
      }
    });

    await page.goto('/office');
    await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 });

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('Oficina de Arquitectura — panel autenticado', () => {
  // WebKit (iPad Safari) no resuelve la sesión de Auth de forma fiable contra el
  // stack local (persistencia del preview); la cobertura autenticada corre
  // en desktop-chromium y el smoke sin autenticación sigue cubriendo iPad.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');

  test.beforeEach(async ({ page }) => {
    await signInE2E(page);
  });

  test('el wizard real lista el proyecto seedeado y propone un charter válido', async ({ page }) => {
    await page.goto('/office');
    await expect(page.getByRole('heading', { name: /Panel de la Oficina/i })).toBeVisible({ timeout: 15_000 });

    // El botón real abre EngagementIntakeWizard (título "Nuevo entregable").
    // Si el wizard lista el proyecto e iniciativa del seed, el ciclo
    // login -> RLS/RPC -> lectura del portafolio funciona de extremo
    // a extremo; es la verificación real del tenant sembrado.
    await page.getByRole('button', { name: 'Nuevo entregable' }).click();
    const dialog = page.getByRole('dialog', { name: /Nuevo entregable/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const projectSelect = dialog.getByLabel(/Proyecto de arquitectura de destino/);
    await expect(projectSelect).toBeVisible({ timeout: 15_000 });
    await expect(projectSelect.locator('option[value="e2e-project"]')).toHaveCount(1, { timeout: 15_000 });

    await projectSelect.selectOption('e2e-project');
    // `exact` porque cada campo tiene al lado un botón de captura asistida cuyo
    // nombre accesible contiene el del campo («Sugerir título del entregable con
    // el arquitecto agente»). Sin él, `getByLabel` resuelve a dos elementos y
    // Playwright falla en modo estricto — que es exactamente lo que debe hacer:
    // el ambiguo era el localizador, no la etiqueta del botón, que dice lo que
    // el botón hace.
    await dialog.getByLabel('Título del entregable', { exact: true }).fill('Modernización de siniestros E2E');
    await dialog.getByLabel('¿Qué necesita el negocio?', { exact: true }).fill(
      'Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce Health Cloud, cumpliendo HIPAA.',
    );
    await dialog.getByRole('button', { name: 'Proponer plan de trabajo' }).click();

    // El charter determinista se compone sin IA, así que debe aparecer incluso
    // si el proveedor no responde. Productor y revisor son siempre personas
    // distintas: la regla de la Oficina que este flujo defiende.
    await expect(dialog.getByText('Artefactos y responsables')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText(/^Produce /).first()).toBeVisible();
    await expect(dialog.getByText(/^Revisa /).first()).toBeVisible();
  });
});

/**
 * El comité, firmado por quien no escribió el encargo.
 *
 * Va en su propio bloque porque la sesión es otra, y **tiene que serlo**: desde
 * F2-03 (opción C, ADR-101) `decide_engagement` aborta con `42501` si el autor
 * firma su propio encargo. Este recorrido hacía exactamente eso —la cuenta que
 * posee el fixture pulsaba «Aprobar entrega»— y pasaba sólo porque el servidor
 * aún no imponía la regla; el día que empezó a imponerla, el recorrido la
 * encontró. Se corrige el fixture, no la regla.
 *
 * La revisora es `reviewer`, el rol cuyo propósito entero es gobernar, así que
 * el recorrido prueba además que `arb:decide` basta para firmar: no hace falta
 * ser administrador. Llega al encargo por la bandeja global
 * (`api.load_arb_engagements`), que es lo que la opción C añadió para que un
 * revisor descubra trabajo ajeno sin adueñarse de su proyecto.
 */
test.describe('Oficina de Arquitectura — comité', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');

  test.beforeEach(async ({ page }) => {
    await signInE2E(page, E2E_REVIEWER);
  });

  test('una revisora ajena firma la entrega, y el autor la ve firmada', async ({ page, browser, contextOptions }) => {
    // El fixture llega al comité con gates condicionales, que son deliberables:
    // el ARB puede aceptar condiciones, pero nunca saltar un gate bloqueado.
    await page.goto('/office/e2e-engagement-arb');

    // La bandeja sólo trae encargos en `awaiting-arb`/`blocked`, así que un
    // reintento de Playwright —que comparte el stack local de esta ejecución—
    // encuentra la sala vacía si el intento anterior ya firmó. Las dos salidas
    // se esperan a la vez: firmar dos veces violaría la máquina de estados, y
    // asumir que la sala está ahí convertiría un reintento en un fallo que no
    // se parece a su causa.
    const room = page.getByRole('heading', { name: 'Decisión ARB E2E' });
    const alreadyDecided = page.getByText('Entregable no encontrado');
    await expect(room.or(alreadyDecided).first()).toBeVisible({ timeout: 15_000 });

    if (await room.isVisible()) {
      const committee = page.locator('#comite');
      const approve = committee.getByRole('button', { name: 'Aprobar entrega' });
      await expect(approve).toBeEnabled();
      await approve.click();
      // La sala se actualiza desde el agregado que devuelve la RPC, no desde un
      // toast: el estado prueba el ciclo UI → RLS/RPC → PostgreSQL → UI.
      await expect(page.getByText('Entregado', { exact: true })).toBeVisible({ timeout: 15_000 });
    }

    // La verificación la hace el autor, y por eso vive en otra sesión: es la
    // única de las dos que ve el encargo en cualquier estado, así que el aserto
    // significa lo mismo en el primer intento y en un reintento. Y afirma lo que
    // de verdad importa de la opción C: el autor encuentra su entregable firmado
    // por alguien que no es él.
    const authorContext = await browser.newContext(contextOptions);
    try {
      const authorPage = await authorContext.newPage();
      await signInE2E(authorPage, E2E_ARCHITECT);
      await authorPage.goto('/office/e2e-engagement-arb');
      await expect(authorPage.getByRole('heading', { name: 'Decisión ARB E2E' })).toBeVisible({ timeout: 15_000 });
      await expect(authorPage.getByText('Entregado', { exact: true })).toBeVisible({ timeout: 15_000 });

      const committee = authorPage.locator('#comite');
      await expect(committee.getByText('Decisiones registradas')).toBeVisible();
      await expect(committee.getByText('Aprobado', { exact: true })).toBeVisible();
      // El nombre lo canoniza el servidor desde el perfil de la sesión que firmó,
      // así que leerlo aquí es leer quién decidió de verdad, no quién lo propuso.
      await expect(committee.getByText(E2E_REVIEWER.displayName, { exact: true })).toBeVisible();
      await expect(committee.getByText(E2E_ARCHITECT.displayName, { exact: true })).toHaveCount(0);
    } finally {
      await authorContext.close();
    }
  });
});
