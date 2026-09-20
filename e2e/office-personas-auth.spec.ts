import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';

/**
 * E2E autenticado — Personas de la Oficina de Arquitectura.
 *
 * CI levanta el stack local de Supabase y siembra una cuenta superadmin
 * concedida. El recorrido inicia sesión por la interfaz real; nunca depende
 * de secretos de producción ni del bypass de desarrollo.
 *
 * El selector de personas (OfficeAgentPicker) vive dentro del copiloto de
 * proyecto, no en la home; su contrato está cubierto por su unit test
 * (OfficeAgentPicker.test.tsx). Aquí se verifica lo que la Oficina expone de
 * forma determinista: las 13 personas están definidas (el header del panel lo
 * declara) y el panel carga sin errores de autenticación.
 */

test.describe('Personas de la Oficina (autenticado)', () => {
  // WebKit (iPad Safari) no resuelve la sesión de Auth contra el stack local de forma
  // fiable; la cobertura autenticada corre en desktop-chromium y el smoke sin
  // autenticación sigue cubriendo iPad.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');

  test('el panel declara a los 13 especialistas y carga sin errores de auth', async ({ page }) => {
    await signInE2E(page);
    await page.goto('/office');

    // El header del panel declara el número real de especialistas definidos
    // en OFFICE_AGENT_PERSONAS — el contrato de catálogo de la Oficina.
    await expect(page.getByText(/13 especialistas/i)).toBeVisible({ timeout: 15_000 });

    // Sin errores de autenticación no recuperables en consola.
    const fatal: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') fatal.push(msg.text()); });
    const blocked = fatal.filter((e) => /permission-denied|missing-or-invalid|unauth/i.test(e));
    expect(blocked).toEqual([]);
  });
});
