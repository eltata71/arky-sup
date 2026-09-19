import { expect, type Page } from '@playwright/test';

export const E2E_ACCOUNT = {
  email: 'architect@arky.e2e',
  password: 'Arky-E2E-Only-2026!',
} as const;

/** Sign in through the real UI against the isolated local Supabase stack. */
export async function signInE2E(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.getByLabel('Correo electrónico').fill(E2E_ACCOUNT.email);
  await page.getByLabel('Contraseña').fill(E2E_ACCOUNT.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByText(/Configuración de Supabase está incompleta/i)).toHaveCount(0);
}
