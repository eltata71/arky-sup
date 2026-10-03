import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { accessTokenOf, rpc } from './backend';

/**
 * Los pasos que comparten los recorridos que generan (F6-04, 10.0): crear una
 * iniciativa y abrir un proyecto desde ella, leyendo de la base lo que guardó.
 */

export const uniqueSuffix = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function createInitiative(page: Page, title: string): Promise<string> {
  await page.goto('/initiatives');
  await page.getByRole('button', { name: 'Nueva iniciativa' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Nueva iniciativa/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel('Título de la iniciativa', { exact: true }).fill(title);
  await dialog.getByLabel('¿Qué necesita el negocio?', { exact: true }).fill(
    'Reducir de doce a dos días el alta de una póliza colectiva, hoy manual y en papel.',
  );
  await dialog.getByRole('button', { name: 'Continuar sin asistente' }).click();
  await dialog.getByRole('button', { name: 'Crear iniciativa' }).click();
  await expect(page).toHaveURL(/\/initiatives\/[^/?#]+$/, { timeout: 15_000 });
  return new URL(page.url()).pathname.split('/').pop()!;
}

export interface StoredProject {
  id: string;
  initiativeIds?: string[];
  artifacts?: { id: string; name: string; content: string; revision?: number }[];
}

/** Abre un proyecto desde la iniciativa, por plantilla, y devuelve su id tal como la base lo guardó. */
export async function createProjectFor(page: Page, request: APIRequestContext, initiativeId: string): Promise<string> {
  await page.goto(`/projects?iniciativa=${initiativeId}&crear=plantilla`);
  await page.getByRole('button', { name: /Gestión de Reclamos de Vida/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Elige los primeros artefactos/ }))
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Volver', exact: true }).click();

  const token = await accessTokenOf(page);
  let projectId = '';
  await expect.poll(async () => {
    const projects = await rpc<StoredProject[]>(request, token, 'list_project_aggregates');
    projectId = projects.find((project) => project.initiativeIds?.includes(initiativeId))?.id ?? '';
    return projectId;
  }, { timeout: 15_000, message: 'El proyecto no llegó a la base' }).not.toBe('');
  return projectId;
}
