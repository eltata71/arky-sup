/**
 * The only way to build an inventory item. It returns a typed result, never
 * throws, and refuses what would make the inventory lie: no name, an unknown
 * kind, or a name another item of the same kind already answers to (the
 * rejection carries that item's id, so the caller can offer to link instead).
 */

import { newInventoryItemId } from './inventoryIdentity';
import { cleanAliases, cleanInventoryText, findInventoryMatch, normalizeInventoryName } from './inventoryNames';
import { INVENTORY_KINDS, type InventoryItem, type InventoryKind, type InventoryLifecycle } from './InventoryTypes';

export interface CreateInventoryItemInput {
  readonly userId: string;
  readonly kind: InventoryKind;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description?: string;
  readonly lifecycle?: InventoryLifecycle;
  readonly projectIds?: readonly string[];
}

export interface CreateInventoryItemContext {
  readonly now: string;
  /** The user's current inventory, to detect duplicates. */
  readonly existing: readonly InventoryItem[];
  readonly newId?: () => string;
}

export type InventoryRejection =
  | { readonly reason: 'missing-user' }
  | { readonly reason: 'invalid-kind' }
  | { readonly reason: 'missing-name' }
  | { readonly reason: 'duplicate'; readonly existingId: string; readonly existingName: string };

export type CreateInventoryItemResult =
  | { readonly ok: true; readonly item: InventoryItem }
  | { readonly ok: false; readonly rejection: InventoryRejection };

export const uniqueIds = (values: readonly unknown[] | undefined): string[] =>
  Array.from(new Set((values ?? []).filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())));

export const createInventoryItem = (
  input: CreateInventoryItemInput,
  context: CreateInventoryItemContext,
): CreateInventoryItemResult => {
  if (!input.userId?.trim()) return { ok: false, rejection: { reason: 'missing-user' } };
  if (!INVENTORY_KINDS.includes(input.kind)) return { ok: false, rejection: { reason: 'invalid-kind' } };
  const name = cleanInventoryText(input.name);
  const normalizedName = normalizeInventoryName(name);
  if (!normalizedName) return { ok: false, rejection: { reason: 'missing-name' } };
  const aliases = cleanAliases(name, input.aliases ?? []);
  const clash = findInventoryMatch(context.existing, input.kind, [name, ...aliases]);
  if (clash) {
    return { ok: false, rejection: { reason: 'duplicate', existingId: clash.id, existingName: clash.name } };
  }
  return {
    ok: true,
    item: {
      id: (context.newId ?? newInventoryItemId)(),
      schemaVersion: 1,
      userId: input.userId,
      kind: input.kind,
      name,
      normalizedName,
      aliases,
      description: cleanInventoryText(input.description),
      lifecycle: input.lifecycle ?? 'candidate',
      projectIds: uniqueIds(input.projectIds),
      createdAt: context.now,
      updatedAt: context.now,
    },
  };
};
