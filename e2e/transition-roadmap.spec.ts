import { expect, test } from '@playwright/test';
import { signInE2E } from './support/auth';
import { accessTokenOf, hasBackendAccess } from './support/backend';
import { loadProject, seedAttention, seedInventoryItem } from './support/enterprise';
import { createInitiative, createProjectFor, uniqueSuffix } from './support/journeys';

/**
 * 11.4 — el recorrido real del plan de transición: línea base, objetivo,
 * brechas derivadas, mesetas, orden con botones y un hito enlazado por id.
 * Lo comprueba contra la base, no sólo contra la pantalla.
 */

test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(!hasBackendAccess(), 'Necesita SUPABASE_URL y la clave publicable del stack local (e2e.yml las exporta).');

interface StoredTransition {
  attention?: { transition?: { baseline?: string[]; target?: string[]; plateaus?: { name: string; milestoneId?: string }[] } };
}

test.describe('Plan de transición — recorrido de la hoja de ruta', () => {
  test.beforeEach(async ({ page }) => { await signInE2E(page); });

  test('arma brechas y mesetas, las reordena con teclado y lo guarda', async ({ page, request }) => {
    test.setTimeout(180_000);
    const suffix = uniqueSuffix();
    const initiativeId = await createInitiative(page, `Transición E2E ${suffix}`);
    const projectId = await createProjectFor(page, request, initiativeId);
    const token = await accessTokenOf(page);

    const legacy = `Core legado ${suffix}`;
    const modern = `Plataforma de pólizas ${suffix}`;
    await seedInventoryItem(request, token, { id: `inv-legacy-${suffix}`, kind: 'application', name: legacy });
    await seedInventoryItem(request, token, { id: `inv-modern-${suffix}`, kind: 'application', name: modern });
    await seedAttention(request, token, projectId, {
      status: 'in-progress',
      priority: 'medium',
      milestones: [{ id: `ms-${suffix}`, name: `Hito corte ${suffix}`, dueAt: '2027-03-31', status: 'pending' }],
    });

    await page.goto('/transition');
    await page.getByRole('combobox', { name: /^Proyecto/ }).selectOption(projectId);

    await page.getByLabel('Añadir a la línea base').selectOption({ label: legacy });
    await page.getByRole('button', { name: 'Añadir a la base' }).click();
    await page.getByLabel('Añadir al objetivo').selectOption({ label: modern });
    await page.getByRole('button', { name: 'Añadir al objetivo' }).click();

    const gaps = page.getByRole('table', { name: 'Brechas entre la línea base y el objetivo' });
    await expect(gaps.getByText(legacy)).toBeVisible();
    await expect(gaps.getByText(modern)).toBeVisible();

    for (const name of ['Meseta A', 'Meseta B']) {
      await page.getByLabel('Nombre de la meseta').fill(name);
      await page.getByRole('button', { name: 'Añadir meseta' }).click();
    }
    const plateaus = page.getByRole('list', { name: 'Mesetas en orden' }).getByRole('listitem');
    await expect(plateaus).toHaveCount(2);
    await expect(plateaus.first()).toContainText('Meseta A');

    await plateaus.nth(1).getByRole('button', { name: 'Antes' }).focus();
    await page.keyboard.press('Enter');
    await expect(plateaus.first()).toContainText('Meseta B');

    await plateaus.first().getByLabel(/^Hito de/).selectOption({ label: `Hito corte ${suffix}` });
    await expect(plateaus.first()).toContainText('2027-03-31');

    await expect.poll(async () => {
      const stored = await loadProject<StoredTransition>(request, token, projectId);
      const transition = stored.attention?.transition;
      return JSON.stringify({
        baseline: transition?.baseline?.length,
        target: transition?.target?.length,
        order: transition?.plateaus?.map((p) => p.name),
        linked: Boolean(transition?.plateaus?.[0]?.milestoneId),
      });
    }, { timeout: 20_000, message: 'El plan no llegó a la base como se armó' })
      .toBe(JSON.stringify({ baseline: 1, target: 1, order: ['Meseta B', 'Meseta A'], linked: true }));
  });
});
