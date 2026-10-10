/**
 * Assisted promotion: "this entity appears in N projects".
 *
 * Reads the knowledge graphs (through a structural port, so this context does
 * not import the graph's) and PROPOSES inventory items. It never creates,
 * links or merges anything: `acceptPromotion` is called by a human click and
 * returns the plan — the item to store and the graph entities to point at it —
 * for the caller to persist. An entity already linked is not proposed again; a
 * name the inventory already answers to is proposed as a *link*, not a copy.
 */

import { createInventoryItem, type CreateInventoryItemContext } from '../domain/inventoryFactory';
import { applyInventoryCommand } from '../domain/inventoryCommands';
import { findInventoryMatch, normalizeInventoryName } from '../domain/inventoryNames';
import type { InventoryItem, InventoryKind } from '../domain/InventoryTypes';

/** What promotion needs to know about a graph entity. */
export interface PromotableEntity {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: string;
  readonly aliases?: readonly string[];
  readonly inventoryItemId?: string;
}

/** Graph entity types that have an inventory counterpart. Everything else is not inventory. */
const KIND_BY_ENTITY_TYPE: Readonly<Record<string, InventoryKind>> = {
  system: 'application',
  application: 'application',
  businessCapability: 'capability',
  database: 'technology',
  dataStore: 'technology',
};

export const inventoryKindForEntityType = (type: string): InventoryKind | undefined => KIND_BY_ENTITY_TYPE[type];

export interface EntityReference {
  readonly entityId: string;
  readonly projectId: string;
}

export interface PromotionProposal {
  /** Stable across recomputations: kind + normalized name. */
  readonly key: string;
  readonly kind: InventoryKind;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly projectIds: readonly string[];
  readonly references: readonly EntityReference[];
  /** The inventory item that already answers to this name, when there is one: the proposal is then to LINK. */
  readonly matchesItem?: { readonly id: string; readonly name: string };
}

export interface ProposePromotionsOptions {
  /** Minimum number of distinct projects. Default 2: one project is a mention, not an enterprise asset. */
  readonly minProjects?: number;
}

export const proposePromotions = (
  entities: readonly PromotableEntity[],
  inventory: readonly InventoryItem[],
  options: ProposePromotionsOptions = {},
): PromotionProposal[] => {
  const minProjects = Math.max(1, options.minProjects ?? 2);
  const groups = new Map<string, { kind: InventoryKind; names: string[]; aliases: string[]; entities: PromotableEntity[] }>();

  for (const entity of entities) {
    if (entity.inventoryItemId) continue;
    const kind = inventoryKindForEntityType(entity.type);
    const normalized = normalizeInventoryName(entity.name);
    if (!kind || !normalized) continue;
    const key = `${kind}:${normalized}`;
    const group = groups.get(key) ?? { kind, names: [], aliases: [], entities: [] };
    group.names.push(entity.name);
    group.aliases.push(...(entity.aliases ?? []));
    group.entities.push(entity);
    groups.set(key, group);
  }

  const proposals: PromotionProposal[] = [];
  groups.forEach((group, key) => {
    const projectIds = Array.from(new Set(group.entities.map((e) => e.projectId))).sort();
    if (projectIds.length < minProjects) return;
    const name = group.names.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    const aliases = Array.from(new Set([...group.names, ...group.aliases].filter((n) => n !== name)));
    const match = findInventoryMatch(inventory, group.kind, [name, ...aliases]);
    proposals.push({
      key,
      kind: group.kind,
      name,
      aliases,
      projectIds,
      references: group.entities.map((e) => ({ entityId: e.id, projectId: e.projectId })),
      ...(match ? { matchesItem: { id: match.id, name: match.name } } : {}),
    });
  });
  return proposals.sort((a, b) => b.projectIds.length - a.projectIds.length || a.name.localeCompare(b.name));
};

export type PromotionPlan =
  | {
      readonly ok: true;
      /** The item to store (new, or the existing one with the projects added). */
      readonly item: InventoryItem;
      readonly created: boolean;
      /** Graph entities to stamp with `inventoryItemId = item.id`. */
      readonly references: readonly EntityReference[];
    }
  | { readonly ok: false; readonly reason: string };

/** Called only by an explicit human click on one proposal. Pure: persisting is the caller's job. */
export const acceptPromotion = (
  proposal: PromotionProposal,
  context: { readonly userId: string; readonly now: string; readonly inventory: readonly InventoryItem[]; readonly newId?: () => string },
): PromotionPlan => {
  const existing = proposal.matchesItem
    ? context.inventory.find((i) => i.id === proposal.matchesItem?.id)
    : undefined;

  if (existing) {
    let item = existing;
    const others = context.inventory.filter((i) => i.id !== existing.id);
    for (const projectId of proposal.projectIds) {
      const result = applyInventoryCommand(item, { type: 'link-project', projectId }, { now: context.now, others });
      if (result.ok) item = result.item;
    }
    for (const alias of proposal.aliases) {
      const result = applyInventoryCommand(item, { type: 'add-alias', alias }, { now: context.now, others });
      if (result.ok) item = result.item; // an alias another item owns is skipped, not forced
    }
    return { ok: true, item, created: false, references: proposal.references };
  }

  const factoryContext: CreateInventoryItemContext = {
    now: context.now,
    existing: context.inventory,
    newId: context.newId,
  };
  const created = createInventoryItem(
    { userId: context.userId, kind: proposal.kind, name: proposal.name, aliases: proposal.aliases, projectIds: proposal.projectIds },
    factoryContext,
  );
  if (!created.ok) return { ok: false, reason: created.rejection.reason };
  return { ok: true, item: created.item, created: true, references: proposal.references };
};
