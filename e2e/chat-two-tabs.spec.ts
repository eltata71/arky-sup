import { expect, test } from '@playwright/test';
import { signInE2E, E2E_ARCHITECT } from './support/auth';
import { accessTokenOf, hasBackendAccess, rpc } from './support/backend';
import { createInitiative, createProjectFor, uniqueSuffix } from './support/journeys';

/**
 * 14.3 · R-03 — Dos pestañas sobre el mismo proyecto no se pierden mensajes.
 *
 * Antes `save_chat_history` reescribía la lista entera: la última pestaña en
 * guardar borraba lo que la otra acababa de escribir. Ahora cada mensaje es una
 * fila y escribir es añadir. Cada «pestaña» llama a la RPC con su propia sesión
 * y **sin conocer lo que escribió la otra**, que es exactamente la situación
 * que antes perdía datos; después se lee lo que la base guardó de verdad.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'Journeys autenticados: sólo desktop-chromium.');
test.skip(() => !hasBackendAccess(), 'Necesita el stack local de Supabase.');

const message = (id: string, content: string) => ({ id, role: 'user', content, timestamp: new Date().toISOString() });

test('dos pestañas que escriben a la vez conservan todos los mensajes, una sola vez', async ({ browser, request }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  await signInE2E(tabA, E2E_ARCHITECT);
  const initiativeId = await createInitiative(tabA, `Chat dos pestañas ${uniqueSuffix()}`);
  const projectId = await createProjectFor(tabA, request, initiativeId);
  const tokenA = await accessTokenOf(tabA);

  const tabB = await context.newPage();
  await tabB.goto(`/workspace/${projectId}`);
  const tokenB = await accessTokenOf(tabB);

  const suffix = uniqueSuffix();
  const a1 = message(`a1-${suffix}`, 'Pestaña A, primero');
  const a2 = message(`a2-${suffix}`, 'Pestaña A, segundo');
  const b1 = message(`b1-${suffix}`, 'Pestaña B, sin saber de A');

  await rpc(request, tokenA, 'append_chat_messages', { p_project_id: projectId, p_messages: [a1, a2] });
  await rpc(request, tokenB, 'append_chat_messages', { p_project_id: projectId, p_messages: [b1] });
  // Reintento de red de A: reenviar lo ya guardado no duplica.
  await rpc(request, tokenA, 'append_chat_messages', { p_project_id: projectId, p_messages: [a1, a2] });

  const stored = await rpc<{ id: string }[]>(request, tokenA, 'load_chat_history', { p_project_id: projectId });
  const ids = stored.map((m) => m.id).filter((id) => id.endsWith(suffix));
  expect(ids).toEqual([a1.id, a2.id, b1.id]);
  await context.close();
});
