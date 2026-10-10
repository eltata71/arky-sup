/**
 * The capability map (11.3): the L1/L2/L3 tree and the value each overlay
 * (maturity, investment, risk, initiative coverage) takes on every node.
 *
 * Pure. Honesty rules, the same as the rest of the portfolio:
 *  - unmeasured is `null`, never 0 — a node nobody assessed is not "maturity 0";
 *  - a value taken from the children says so (`source: 'derived'`);
 *  - a reference that does not resolve is reported (`issues`), never dropped;
 *  - coverage is derived through ids (capability → projects → initiatives), and
 *    the initiatives arrive through a port so this context imports none.
 */

import { capabilityLevel } from '../domain/capabilityAttributes';
import type { InventoryItem } from '../domain/InventoryTypes';

export type CapabilityLayer = 'maturity' | 'investment' | 'risk' | 'coverage';

export const CAPABILITY_LAYERS: readonly CapabilityLayer[] = ['maturity', 'investment', 'risk', 'coverage'];

/** The initiatives each project serves, resolved by the caller (ids first). */
export type InitiativesByProject = ReadonlyMap<string, readonly string[]>;

export interface LayerValue {
  /** 0..1 position on the layer's scale, `null` when nothing was measured. */
  readonly intensity: number | null;
  /** The raw figure in the layer's own scale (maturity 1-5, initiatives count…), `null` when unmeasured. */
  readonly value: number | null;
  readonly source: 'declared' | 'derived' | null;
}

export interface CapabilityNode {
  readonly item: InventoryItem;
  readonly level: number;
  readonly children: readonly CapabilityNode[];
  readonly supportingApplications: readonly InventoryItem[];
  readonly initiativeIds: readonly string[];
  readonly layers: Readonly<Record<CapabilityLayer, LayerValue>>;
}

export type CapabilityMapIssue =
  | { readonly type: 'unresolved-parent'; readonly capabilityId: string; readonly parentId: string }
  | { readonly type: 'unresolved-application'; readonly capabilityId: string; readonly applicationId: string }
  | { readonly type: 'too-deep'; readonly capabilityId: string; readonly level: number };

export interface CapabilityMap {
  readonly roots: readonly CapabilityNode[];
  readonly issues: readonly CapabilityMapIssue[];
  readonly total: number;
  /** Capabilities nobody linked to a project or an initiative: the work the business waits for. */
  readonly uncoveredIds: readonly string[];
}

const INVESTMENT_RANK = { none: 0, low: 1, medium: 2, high: 3 } as const;
const RISK_RANK = { low: 1, medium: 2, high: 3 } as const;

const NONE: LayerValue = { intensity: null, value: null, source: null };

const declaredValue = (item: InventoryItem, layer: Exclude<CapabilityLayer, 'coverage'>): { value: number; intensity: number } | null => {
  const c = item.capability;
  if (!c) return null;
  if (layer === 'maturity') return c.maturity ? { value: c.maturity, intensity: (c.maturity - 1) / 4 } : null;
  if (layer === 'investment') return c.investment ? { value: INVESTMENT_RANK[c.investment], intensity: INVESTMENT_RANK[c.investment] / 3 } : null;
  return c.risk ? { value: RISK_RANK[c.risk], intensity: (RISK_RANK[c.risk] - 1) / 2 } : null;
};

/** Maximum initiatives that saturate the coverage scale. */
export const COVERAGE_SATURATION = 3;

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export const buildCapabilityMap = (
  inventory: readonly InventoryItem[],
  initiativesByProject: InitiativesByProject = new Map(),
): CapabilityMap => {
  const live = inventory.filter((i) => i.lifecycle !== 'retired');
  const capabilities = live.filter((i) => i.kind === 'capability');
  const applications = new Map(inventory.filter((i) => i.kind === 'application').map((i) => [i.id, i]));
  const ids = new Set(capabilities.map((c) => c.id));
  const issues: CapabilityMapIssue[] = [];

  const childrenOf = new Map<string, InventoryItem[]>();
  const roots: InventoryItem[] = [];
  for (const c of capabilities) {
    const parentId = c.capability?.parentId;
    if (parentId && ids.has(parentId)) childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), c]);
    else {
      if (parentId) issues.push({ type: 'unresolved-parent', capabilityId: c.id, parentId });
      roots.push(c);
    }
  }
  const byName = (a: InventoryItem, b: InventoryItem) => a.name.localeCompare(b.name, 'es');

  const uncovered: string[] = [];
  const visited = new Set<string>();

  const build = (item: InventoryItem): CapabilityNode => {
    visited.add(item.id);
    const level = capabilityLevel(item, capabilities);
    if (level > 3) issues.push({ type: 'too-deep', capabilityId: item.id, level });
    const children = (childrenOf.get(item.id) ?? []).filter((c) => !visited.has(c.id)).sort(byName).map(build);

    const supportingApplications: InventoryItem[] = [];
    for (const applicationId of item.capability?.supportedByIds ?? []) {
      const app = applications.get(applicationId);
      if (app) supportingApplications.push(app);
      else issues.push({ type: 'unresolved-application', capabilityId: item.id, applicationId });
    }

    const own = new Set(item.projectIds.flatMap((p) => initiativesByProject.get(p) ?? []));
    const initiativeIds = [...new Set([...own, ...children.flatMap((c) => c.initiativeIds)])];
    if (!item.projectIds.length && !children.length) uncovered.push(item.id);

    const layers = {} as Record<CapabilityLayer, LayerValue>;
    for (const layer of ['maturity', 'investment', 'risk'] as const) {
      const declared = declaredValue(item, layer);
      if (declared) {
        layers[layer] = { ...declared, source: 'declared' };
        continue;
      }
      const fromChildren = children.map((c) => c.layers[layer]).filter((l): l is LayerValue & { value: number; intensity: number } => l.value !== null && l.intensity !== null);
      layers[layer] = fromChildren.length
        ? { value: Math.round(mean(fromChildren.map((l) => l.value)) * 10) / 10, intensity: mean(fromChildren.map((l) => l.intensity)), source: 'derived' }
        : NONE;
    }
    layers.coverage = {
      value: initiativeIds.length,
      intensity: Math.min(initiativeIds.length, COVERAGE_SATURATION) / COVERAGE_SATURATION,
      source: 'derived',
    };

    return { item, level, children, supportingApplications, initiativeIds, layers };
  };

  const nodes = roots.sort(byName).map(build);
  return { roots: nodes, issues, total: capabilities.length, uncoveredIds: uncovered };
};

/** Flat, depth-first list — what a keyboard or screen-reader view walks. */
export const flattenCapabilityMap = (map: CapabilityMap): CapabilityNode[] => {
  const out: CapabilityNode[] = [];
  const walk = (n: CapabilityNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  map.roots.forEach(walk);
  return out;
};
