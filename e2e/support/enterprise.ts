import type { APIRequestContext } from '@playwright/test';
import { rpc } from './backend';

/**
 * Siembra del inventario empresarial y del seguimiento de un proyecto (ola 11):
 * lo que una persona tardaría minutos en capturar a mano, escrito por las
 * mismas RPC que usa la aplicación.
 */

export const userIdOf = (token: string): string =>
  (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { sub: string }).sub;

export interface SeedInventoryItem {
  id: string;
  kind: 'application' | 'capability' | 'technology';
  name: string;
  capability?: Record<string, unknown>;
  application?: Record<string, unknown>;
  technology?: Record<string, unknown>;
}

export async function seedInventoryItem(request: APIRequestContext, token: string, item: SeedInventoryItem): Promise<void> {
  const now = new Date().toISOString();
  await rpc(request, token, 'save_enterprise_inventory_item', {
    p_item: {
      ...item,
      schemaVersion: 1,
      userId: userIdOf(token),
      normalizedName: item.name.toLowerCase(),
      aliases: [],
      description: '',
      lifecycle: 'active',
      projectIds: [],
      createdAt: now,
      updatedAt: now,
    },
    p_expected_revision: 0,
  });
}

interface LoadedProject extends Record<string, unknown> { revision: number }

/** Escribe `attention` en la raíz del proyecto, con la revisión que la base devolvió. */
export async function seedAttention(
  request: APIRequestContext,
  token: string,
  projectId: string,
  attention: Record<string, unknown>,
): Promise<void> {
  const loaded = await rpc<LoadedProject>(request, token, 'load_project_aggregate', { p_id: projectId });
  const { revision, artifacts: _artifacts, artifactIndex: _index, artifactCount: _count, ...root } = loaded as LoadedProject & {
    artifacts?: unknown; artifactIndex?: unknown; artifactCount?: unknown;
  };
  await rpc(request, token, 'save_project', {
    p_project: { ...root, userId: userIdOf(token), attention },
    p_expected_revision: revision,
  });
}

export async function loadProject<T = Record<string, unknown>>(request: APIRequestContext, token: string, projectId: string): Promise<T> {
  return rpc<T>(request, token, 'load_project_aggregate', { p_id: projectId });
}
