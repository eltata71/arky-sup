/**
 * What a capability says beyond being an inventory item (11.3): where it sits
 * in the L1/L2/L3 map and the three things the map overlays. Everything is
 * optional — an unmeasured value is absent, never 0 — and everything points at
 * other records by id.
 */

import type { InventoryItem } from './InventoryTypes';

export const MAX_CAPABILITY_LEVEL = 3;

export const CAPABILITY_MATURITIES = [1, 2, 3, 4, 5] as const;
export type CapabilityMaturity = (typeof CAPABILITY_MATURITIES)[number];

export const CAPABILITY_INVESTMENTS = ['none', 'low', 'medium', 'high'] as const;
export type CapabilityInvestment = (typeof CAPABILITY_INVESTMENTS)[number];

export const CAPABILITY_RISKS = ['low', 'medium', 'high'] as const;
export type CapabilityRisk = (typeof CAPABILITY_RISKS)[number];

export interface CapabilityAttributes {
  /** Parent capability. Absent for an L1. The level is derived from the chain, never stored. */
  readonly parentId?: string;
  readonly maturity?: CapabilityMaturity;
  readonly investment?: CapabilityInvestment;
  readonly risk?: CapabilityRisk;
  /** Ids of the applications that support this capability. */
  readonly supportedByIds?: readonly string[];
}

export const isCapabilityMaturity = (value: unknown): value is CapabilityMaturity =>
  CAPABILITY_MATURITIES.includes(value as CapabilityMaturity);

/** Reads stored attributes: what is valid is kept, what is not is dropped. */
export const readCapabilityAttributes = (raw: unknown): CapabilityAttributes | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const parentId = typeof r.parentId === 'string' && r.parentId.trim() ? r.parentId.trim() : undefined;
  const supported = Array.isArray(r.supportedByIds)
    ? Array.from(new Set(r.supportedByIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())))
    : [];
  const attributes: CapabilityAttributes = {
    ...(parentId ? { parentId } : {}),
    ...(isCapabilityMaturity(r.maturity) ? { maturity: r.maturity } : {}),
    ...(CAPABILITY_INVESTMENTS.includes(r.investment as CapabilityInvestment) ? { investment: r.investment as CapabilityInvestment } : {}),
    ...(CAPABILITY_RISKS.includes(r.risk as CapabilityRisk) ? { risk: r.risk as CapabilityRisk } : {}),
    ...(supported.length ? { supportedByIds: supported } : {}),
  };
  return Object.keys(attributes).length ? attributes : undefined;
};

const capabilitiesById = (items: readonly InventoryItem[]): ReadonlyMap<string, InventoryItem> =>
  new Map(items.filter((i) => i.kind === 'capability').map((i) => [i.id, i]));

/** Ancestors from the parent upwards. Stops at a missing parent or a cycle, so it always terminates. */
export const capabilityAncestors = (item: InventoryItem, items: readonly InventoryItem[]): InventoryItem[] => {
  const byId = capabilitiesById(items);
  const chain: InventoryItem[] = [];
  const seen = new Set<string>([item.id]);
  let parentId = item.capability?.parentId;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.push(parent);
    seen.add(parent.id);
    parentId = parent.capability?.parentId;
  }
  return chain;
};

/** 1 for an L1. A capability whose parent no longer resolves reads as L1: reported by the map, not hidden. */
export const capabilityLevel = (item: InventoryItem, items: readonly InventoryItem[]): number =>
  1 + capabilityAncestors(item, items).length;

/** Levels below `item` (0 for a leaf). */
export const capabilitySubtreeHeight = (item: InventoryItem, items: readonly InventoryItem[]): number => {
  const children = new Map<string, InventoryItem[]>();
  for (const c of items) {
    const parentId = c.kind === 'capability' ? c.capability?.parentId : undefined;
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), c]);
  }
  const height = (node: InventoryItem, seen: ReadonlySet<string>): number => {
    const next = (children.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    if (!next.length) return 0;
    const visited = new Set([...seen, ...next.map((c) => c.id)]);
    return 1 + Math.max(...next.map((c) => height(c, visited)));
  };
  return height(item, new Set([item.id]));
};
