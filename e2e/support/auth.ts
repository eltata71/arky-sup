import { expect, type Page } from '@playwright/test';

export const E2E_ACCOUNT = {
  email: 'architect@arky.e2e',
  password: 'Arky-E2E-Only-2026!',
} as const;

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
export async function signInE2E(page: Page): Promise<void> {
  const diagnostics = watchForDiagnostics(page);

  await page.goto('/auth');
  await page.getByLabel('Correo electrónico').fill(E2E_ACCOUNT.email);
  await page.getByLabel('Contraseña').fill(E2E_ACCOUNT.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  try {
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  } catch (cause) {
    // Se relanza con el contexto, no se sustituye: el aserto original sigue
    // siendo la afirmación que falló, y perderlo dejaría un error sin el «qué
    // se esperaba» que lo hace legible.
    const report = [
      `No se completó el inicio de sesión. URL final: ${page.url()}`,
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
