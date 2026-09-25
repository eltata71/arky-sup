import { expect, test, type Page } from '@playwright/test';
import { E2E_PREFERENCES, signInE2E } from './support/auth';

/**
 * F6-04 — Los flujos críticos que escriben, de extremo a extremo.
 *
 * Los recorridos que ya existían cubren la Oficina: el alta de un entregable y
 * la firma del comité. Éstos cubren lo que hay por encima y por debajo, y cada
 * uno **escribe, recarga y vuelve a leer** contra el stack local de Supabase:
 * una escritura que sólo se ve en el estado de React de la pestaña que la hizo
 * no es una escritura.
 *
 *  1. Una iniciativa de negocio se crea sin IA y existe tras recargar.
 *  2. Un proyecto de arquitectura se abre **desde** esa iniciativa —el nivel
 *     padre es obligatorio— y el vínculo, por id, sobrevive a la recarga.
 *  3. Dos cambios de preferencias seguidos se guardan los dos. Es la regresión
 *     de F6-03: la revisión confirmada vuelve al estado, y sin eso la segunda
 *     escritura chocaba con la primera y se revertía.
 *
 * Nada aquí llama a un modelo. El stack de CI no tiene proveedor de IA, y un
 * flujo crítico que sólo funciona con uno no es crítico sino frágil: cada paso
 * elegido tiene su camino sin IA en el producto.
 */

// Igual que los recorridos autenticados de la Oficina: la sesión de Auth en
// WebKit contra el stack local no es fiable, y el smoke sin sesión cubre iPad.
test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');

const uniqueSuffix = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

async function createInitiative(page: Page, title: string): Promise<string> {
  await page.goto('/initiatives');
  await page.getByRole('button', { name: 'Nueva iniciativa' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Nueva iniciativa/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // `exact`: cada campo tiene al lado su botón de captura asistida, cuyo nombre
  // accesible contiene el del campo.
  await dialog.getByLabel('Título de la iniciativa', { exact: true }).fill(title);
  await dialog.getByLabel('¿Qué necesita el negocio?', { exact: true }).fill(
    'Reducir de doce a dos días el alta de una póliza colectiva, hoy manual y en papel.',
  );
  await dialog.getByRole('button', { name: 'Continuar sin asistente' }).click();
  await dialog.getByRole('button', { name: 'Crear iniciativa' }).click();
  await expect(page).toHaveURL(/\/initiatives\/[^/?#]+$/, { timeout: 15_000 });
  return new URL(page.url()).pathname.split('/').pop()!;
}

test.describe('Flujos críticos — iniciativa y proyecto', () => {
  test.beforeEach(async ({ page }) => {
    await signInE2E(page);
  });

  test('una iniciativa creada sin IA existe tras recargar', async ({ page }) => {
    const title = `Alta colectiva E2E ${uniqueSuffix()}`;
    await createInitiative(page, title);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
  });

  test('un proyecto abierto desde la iniciativa queda enlazado a ella, también tras recargar', async ({ page }) => {
    const title = `Reclamos de vida E2E ${uniqueSuffix()}`;
    const initiativeId = await createInitiative(page, title);

    // El enlace que usa la sala: la iniciativa viaja con él, así que la puerta
    // de «¿a qué necesidad responde?» ya está contestada y no se vuelve a pedir.
    await page.goto(`/projects?iniciativa=${initiativeId}&crear=plantilla`);
    await page.getByRole('button', { name: /Gestión de Reclamos de Vida/ }).click();
    // El proyecto ya está creado cuando aparece la selección de artefactos. Las
    // sugerencias piden un modelo y, sin proveedor, caen a una lista fija que
    // llega marcada; «Volver» conserva el proyecto sin generar nada.
    await expect(page.getByRole('heading', { level: 1, name: /Elige los primeros artefactos/ }))
      .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Volver', exact: true }).click();

    // Se relee desde la base, en la sala de la iniciativa: el vínculo es un id
    // que el servidor guardó con el proyecto, no un estado de esta pestaña.
    await page.goto(`/initiatives/${initiativeId}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#proyectos').getByText('Gestión de Reclamos de Vida').first())
      .toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Flujos críticos — preferencias', () => {
  // Cuenta propia: cambia el idioma de la interfaz y las pruebas corren en paralelo.
  test.beforeEach(async ({ page }) => {
    await signInE2E(page, E2E_PREFERENCES);
  });

  test('dos cambios seguidos se guardan los dos, y el último sobrevive a la recarga', async ({ page }) => {
    const heading = (name: string) => page.getByRole('heading', { level: 1, name });
    const choose = async (option: 'English' | 'Español', save: 'Guardar' | 'Save') => {
      await page.getByText(option, { exact: true }).first().click();
      // `exact`: «Guardar Llave Localmente» también es un botón de esta página.
      await page.getByRole('button', { name: save, exact: true }).click();
    };

    await page.goto('/settings');
    await expect(heading('Configuración').or(heading('Settings'))).toBeVisible({ timeout: 15_000 });
    // Un reintento puede empezar donde el intento anterior se quedó.
    if (await heading('Settings').isVisible()) {
      await choose('Español', 'Save');
      await expect(heading('Configuración')).toBeVisible({ timeout: 15_000 });
    }

    // Tres escrituras seguidas. Cada una sólo se queda si la base la confirma:
    // una rechazada revierte la pantalla al valor anterior, y la espera de
    // abajo lo convierte en fallo.
    await choose('English', 'Guardar');
    await expect(heading('Settings')).toBeVisible({ timeout: 15_000 });
    await choose('Español', 'Save');
    await expect(heading('Configuración')).toBeVisible({ timeout: 15_000 });
    await choose('English', 'Guardar');
    await expect(heading('Settings')).toBeVisible({ timeout: 15_000 });

    // Por defecto la interfaz está en español, así que ver inglés tras recargar
    // sólo puede venir de lo que la base guardó.
    await page.reload();
    await expect(heading('Settings')).toBeVisible({ timeout: 15_000 });

    // Deja la cuenta como la encontró.
    await choose('Español', 'Save');
    await expect(heading('Configuración')).toBeVisible({ timeout: 15_000 });
  });
});
