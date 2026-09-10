import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';

/**
 * E2E — Oficina de Arquitectura Empresarial.
 *
 * Este archivo separa la protección de rutas del flujo autenticado. Ambos
 * bloques corren siempre en CI contra un tenant efímero de Firebase Emulator.
 *
 *  1. **Sin autenticación** (corre siempre): las rutas de la Oficina están
 *     protegidas y su chunk carga sin excepciones.
 *
 *  2. **Con autenticación**: el flujo real recepción (Nuevo entregable) →
 *     charter con productor y revisor distintos, contra el tenant aislado de
 *     Auth/Firestore Emulator. Los selectores ejercen la UI que existe — el
 *     wizard real es EngagementIntakeWizard, con su título "Nuevo entregable".
 */

const ENV_NOISE =
  /Failed to load resource|net::|ERR_|MIME type|Refused to apply|Refused to execute|404|DNS|resolve|firebase|No se pudieron cargar settings|lectura de settings falló|googleapis|gstatic|fonts\.|cdn\.|jsdelivr|cloudflare|heroicons|reactflow/i;

test.describe('Oficina de Arquitectura — acceso', () => {
  // `networkidle` nunca llega con los emuladores: el SDK de Firestore mantiene
  // un canal abierto, así que la aserción de URL (con reintento) es la espera.
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
  // WebKit (iPad Safari) en el emulador no resuelve la sesión de Auth de forma
  // fiable (persistencia IndexedDB del preview); la cobertura autenticada corre
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
    // login -> Firestore(rules) -> lectura del portafolio funciona de extremo
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

  test('la sala registra una aprobación ARB y entrega el encargo seedeado', async ({ page }) => {
    // El fixture llega al comité con gates condicionales, que son deliberables:
    // el ARB puede aceptar condiciones, pero nunca saltar un gate bloqueado.
    await page.goto('/office/e2e-engagement-arb');
    await expect(page.getByRole('heading', { name: 'Decisión ARB E2E' })).toBeVisible({ timeout: 15_000 });

    const committee = page.locator('#comite');
    const approve = committee.getByRole('button', { name: 'Aprobar entrega' });

    // Un reintento de Playwright comparte el emulador de esta ejecución. Si el
    // primer intento alcanzó a persistir la firma pero falló una aserción
    // posterior, validar el resultado ya registrado es correcto; intentar
    // firmar otra vez violaría la máquina de estados del agregado.
    if (await approve.isVisible()) {
      await expect(approve).toBeEnabled();
      await approve.click();
    }

    // La sala se actualiza desde el agregado persistido, no sólo desde un toast:
    // estado y rastro de decisión prueban el ciclo UI → reglas → Firestore → UI.
    await expect(page.getByText('Entregado', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(committee.getByText('Decisiones registradas')).toBeVisible();
    await expect(committee.getByText('Aprobado', { exact: true })).toBeVisible();
    await expect(committee.getByText('Arquitecto E2E', { exact: true })).toBeVisible();
  });
});
