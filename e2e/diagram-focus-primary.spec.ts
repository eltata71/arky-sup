import { expect, test } from '@playwright/test';

/**
 * Recomendación 2: focus-primary flow on a large diagram.
 *
 * This is the real Brecha 5 scenario that the user flagged: load a saved
 * diagram, confirm the "Foco principal" affordance appears on a sprawling
 * graph, click it, and verify (a) the focal subset stays visible, (b) the
 * non-focal nodes are dimmed and (c) the inspector / copilot panel doesn't
 * tap over the canvas.
 *
 * It is marked `fixme` because it requires fixtures the current app does
 * not yet expose:
 *
 *   - **Seed mode**: a query-string flag (e.g. `?seed=focus-primary-large`)
 *     that hydrates a deterministic project + diagram into the AppContext
 *     without going through Firebase Auth. Today the home route always
 *     renders the auth wall.
 *   - **Stable selectors**: the toolbar dropdowns currently use generated
 *     ids; the focal mode button needs a stable `data-testid` so this
 *     spec can find it without relying on visible text (which is
 *     localised).
 *
 * Once those land, remove the `test.fixme` line and the spec will run.
 *
 * The skeleton below is the assertion contract we want enforced — keep
 * it accurate against the real UX so a future PR can flip the switch in
 * one place.
 */

test.describe('Diagram canvas — focus-primary flow', () => {
  test.fixme(true, 'Requires the upcoming seed-mode + stable selectors. See spec header.');

  test('large diagram exposes "Foco principal" and dims non-focal nodes on click', async ({ page }) => {
    // 1. Hydrate the deterministic fixture.
    await page.goto('/?seed=focus-primary-large');

    // 2. Wait for the canvas to render.
    const canvas = page.locator('[data-testid="reactflow-canvas"]');
    await expect(canvas).toBeVisible();

    // 3. The smart-viewport hint should flag the diagram as too sprawling.
    const focusButton = page.locator('[data-testid="canvas-focus-primary"]');
    await expect(focusButton).toBeVisible();

    // 4. Click and verify the dim state propagates to non-focal nodes.
    await focusButton.click();
    const dimmed = page.locator('[data-narrative-focus="false"][data-content-node="true"]');
    await expect(dimmed.first()).toBeVisible();

    // 5. Inspector must not overlap the focal subset (sample one focal node
    //    and assert its bbox sits outside the inspector's right edge).
    const focal = page.locator('[data-narrative-focus="true"]').first();
    const inspector = page.locator('[data-testid="diagram-inspector"]');
    if (await inspector.isVisible().catch(() => false)) {
      const focalBox = await focal.boundingBox();
      const inspectorBox = await inspector.boundingBox();
      if (focalBox && inspectorBox) {
        expect(focalBox.x + focalBox.width).toBeLessThanOrEqual(inspectorBox.x);
      }
    }
  });

  test('clicking again restores the full view (toggle contract)', async ({ page }) => {
    await page.goto('/?seed=focus-primary-large');
    const focusButton = page.locator('[data-testid="canvas-focus-primary"]');
    await focusButton.click();
    await focusButton.click();
    const dimmed = page.locator('[data-narrative-focus="false"][data-content-node="true"]');
    await expect(dimmed).toHaveCount(0);
  });
});

/**
 * Visual Quality Gate guards on export and presentation.
 *
 * These also require seed mode (to produce a deterministic blocked /
 * warnings gate state) plus a stable selector for the export modal's
 * banner and the confirm dialog. Same `fixme` strategy.
 */
test.describe('Visual Quality Gate — guards on audience-facing actions', () => {
  test.fixme(true, 'Requires seed-mode + a fixture that forces gate=blocked.');

  test('blocked gate forces a confirm dialog before presenting', async ({ page }) => {
    await page.goto('/?seed=gate-blocked');
    const presentButton = page.locator('[data-testid="canvas-present"]');
    await presentButton.click();
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
  });

  test('hard-block (empty diagram) refuses every export click silently', async ({ page }) => {
    await page.goto('/?seed=gate-hardblock-empty');
    await page.locator('[data-testid="canvas-export"]').click();
    const banner = page.locator('[aria-label="Estado del Visual Quality Gate"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/hard-?block|bloqueo duro/i);
  });
});
