/**
 * Enterprise inventory — the shapes (11.2, R-17 option A: per user).
 *
 * The inventory is what the organisation *has* — applications, capabilities,
 * technologies — as opposed to what one project *mentions*. Every project's
 * knowledge graph may reference an item by id (`ArchitectureEntity.inventoryItemId`);
 * the item never copies the project's text.
 *
 * Scope is the user today (`userId`). The owner lives in its own column in the
 * database, so "per organisation" is an additive migration later, not a rewrite.
 */

import type { CapabilityAttributes } from './capabilityAttributes';

export type InventoryKind = 'application' | 'capability' | 'technology';

export const INVENTORY_KINDS: readonly InventoryKind[] = ['application', 'capability', 'technology'];

/** candidate → active → deprecated → retired. A retired item is never deleted: history is the point. */
export type InventoryLifecycle = 'candidate' | 'active' | 'deprecated' | 'retired';

export const INVENTORY_LIFECYCLES: readonly InventoryLifecycle[] = ['candidate', 'active', 'deprecated', 'retired'];

export interface InventoryItem {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly userId: string;
  readonly kind: InventoryKind;
  /** Canonical, human-readable name. */
  readonly name: string;
  /** Accent-free, lowercase form used to decide that two names are one item. */
  readonly normalizedName: string;
  /** Other names this item is known by (acronyms, legacy names). Never duplicates `name`. */
  readonly aliases: readonly string[];
  readonly description: string;
  readonly lifecycle: InventoryLifecycle;
  /** Ids of the projects in which this item appears — keys, never text. */
  readonly projectIds: readonly string[];
  /** Only for `kind: 'capability'`: its place in the L1/L2/L3 map and what the map overlays. */
  readonly capability?: CapabilityAttributes;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Row witness for optimistic concurrency. Unknown until stored. */
  readonly revision?: number;
}
