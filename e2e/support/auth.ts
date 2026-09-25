import { expect, type Page } from '@playwright/test';

const E2E_PASSWORD = 'Arky-E2E-Only-2026!';

/**
 * Las dos identidades que `scripts/seedE2E.mjs` siembra, y por qué son dos.
 *
 * `decide_engagement` rechaza con `42501` que el autor de un encargo firme su
 * propia decisión del comité (F2-03, opción C, ADR-101). Un recorrido de
 * gobierno con una sola cuenta no prueba la separación de funciones: la elude.
 * El nombre visible importa además de las credenciales, porque la decisión se
 * firma con el `display_name` del perfil —lo canoniza el servidor, no el
 * cliente—, así que es lo que la sala muestra y lo que el aserto lee.
 */
export const E2E_ARCHITECT = {
  email: 'architect@arky.e2e',
  password: E2E_PASSWORD,
  displayName: 'Arquitecto E2E',
} as const;

export const E2E_REVIEWER = {
  email: 'reviewer@arky.e2e',
  password: E2E_PASSWORD,
  displayName: 'Revisora E2E',
} as const;

/**
 * Sólo para el recorrido de preferencias (F6-04): cambia el idioma, y con las
 * pruebas en paralelo una cuenta compartida vería la interfaz en inglés.
 */
export const E2E_PREFERENCES = {
  email: 'preferences@arky.e2e',
  password: E2E_PASSWORD,
  displayName: 'Preferencias E2E',
} as const;

/**
 * Sólo para el recorrido de la bitácora de proyecciones (F6-04): comprueba que
 * un pendiente existe antes de que un arranque lo procese, y otra pestaña de la
 * misma cuenta lo procesaría al abrirse.
 */
export const E2E_PROJECTIONS = {
  email: 'projections@arky.e2e',
  password: E2E_PASSWORD,
  displayName: 'Proyecciones E2E',
} as const;

type E2EAccount =
  | typeof E2E_ARCHITECT
  | typeof E2E_REVIEWER
  | typeof E2E_PREFERENCES
  | typeof E2E_PROJECTIONS;

/**
 * Lo que la pantalla y el navegador dijeron mientras se intentaba entrar.
 *
 * Existe porque `toHaveURL` falla diciendo «esperaba `/`, recibí `/auth`» y
 * nada más, y ésa es una frase que describe el síntoma de **cualquier** fallo de
 * autenticación: credenciales rechazadas, perfil ausente, RPC no expuesta, la
 * base caída. Diagnosticar con eso cuesta una vuelta de CI por hipótesis.
 *
 * Los tres canales son deliberados y ninguno sobra: el texto en pantalla trae el
 * mensaje que el producto decidió mostrar, la consola trae lo que el SDK avisó
 * sin que nadie lo renderizara, y las respuestas no-2xx traen el `code` de
 * PostgREST, que es donde está la causa cuando la pantalla no dice nada.
 */
interface SignInDiagnostics {
  readonly consoleErrors: string[];
  readonly failedResponses: string[];
}

const watchForDiagnostics = (page: Page): SignInDiagnostics => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(`[${message.type()}] ${message.text()}`);
    }
  });

  page.on('response', async (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    // Sólo el backend: un 404 de un favicon no explica nada.
    if (!/\/(auth|rest)\/v1\//.test(url)) return;
    const body = await response.text().then(
      (text) => text.slice(0, 400),
      () => '<cuerpo no legible>',
    );
    failedResponses.push(`${response.status()} ${url} → ${body}`);
  });

  return { consoleErrors, failedResponses };
};

/** El texto que el usuario tiene delante, recortado a lo que cabe leer. */
const visibleText = async (page: Page): Promise<string> => {
  try {
    return (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 600);
  } catch {
    return '<no se pudo leer la página>';
  }
};

/** Sign in through the real UI against the isolated local Supabase stack. */
export async function signInE2E(page: Page, account: E2EAccount = E2E_ARCHITECT): Promise<void> {
  const diagnostics = watchForDiagnostics(page);

  await page.goto('/auth');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(account.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  try {
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  } catch (cause) {
    // Se relanza con el contexto, no se sustituye: el aserto original sigue
    // siendo la afirmación que falló, y perderlo dejaría un error sin el «qué
    // se esperaba» que lo hace legible.
    const report = [
      `No se completó el inicio de sesión de ${account.email}. URL final: ${page.url()}`,
      `Pantalla: ${await visibleText(page)}`,
      diagnostics.failedResponses.length
        ? `Respuestas del backend con error:\n  ${diagnostics.failedResponses.join('\n  ')}`
        : 'El backend no devolvió ninguna respuesta con error.',
      diagnostics.consoleErrors.length
        ? `Consola:\n  ${diagnostics.consoleErrors.slice(0, 15).join('\n  ')}`
        : 'La consola no registró errores ni avisos.',
    ].join('\n');
    throw new Error(`${report}\n\n--- aserto original ---\n${(cause as Error).message}`, { cause });
  }

  await expect(page.getByText(/Configuración de Supabase está incompleta/i)).toHaveCount(0);
}
