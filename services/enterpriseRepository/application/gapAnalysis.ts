/**
 * Análisis de brechas (11.4): de dos listas de ids sale, para cada elemento,
 * qué hay que hacer con él. La clasificación se **calcula**, nunca se guarda:
 * una etiqueta escrita a mano sobrevive al cambio del inventario y miente.
 *
 *   sólo en la línea base           → eliminar
 *   sólo en el objetivo             → nuevo
 *   en ambas y el estado deseado difiere del actual → modificar
 *   en ambas y no difiere           → conservar
 *
 * El plan llega por un puerto estructural (`GapPlanPort`): este contexto no
 * importa el de Proyectos, y Proyectos no importa éste. Se encuentran en un hook.
 */

import type { InventoryItem } from '../domain/InventoryTypes';

export interface GapPlanPort {
  readonly baseline: readonly { readonly itemId: string }[];
  readonly target: readonly {
    readonly itemId: string;
    readonly desired?: {
      readonly lifecycle?: InventoryItem['lifecycle'];
      readonly maturity?: number;
      readonly supportedByIds?: readonly string[];
    };
  }[];
}

export type GapAction = 'keep' | 'eliminate' | 'new' | 'modify';

export type GapChange = 'lifecycle' | 'maturity' | 'supportedBy';

export interface GapEntry {
  readonly itemId: string;
  readonly item: InventoryItem;
  readonly action: GapAction;
  /** Qué cambia, sólo para `modify`. */
  readonly changes: readonly GapChange[];
}

export interface GapIssue {
  readonly kind: 'unresolved-item';
  readonly itemId: string;
  readonly side: 'baseline' | 'target';
}

export interface GapAnalysis {
  readonly entries: readonly GapEntry[];
  readonly counts: Readonly<Record<GapAction, number>>;
  /** Ids que el inventario ya no resuelve: se informan, nunca se descartan en silencio. */
  readonly issues: readonly GapIssue[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v) => b.includes(v));

const changesFor = (item: InventoryItem, desired: GapPlanPort['target'][number]['desired']): GapChange[] => {
  if (!desired) return [];
  const changes: GapChange[] = [];
  if (desired.lifecycle && desired.lifecycle !== item.lifecycle) changes.push('lifecycle');
  if (desired.maturity !== undefined && desired.maturity !== item.capability?.maturity) changes.push('maturity');
  if (desired.supportedByIds && !sameSet(desired.supportedByIds, item.capability?.supportedByIds ?? [])) {
    changes.push('supportedBy');
  }
  return changes;
};

const ORDER: Record<GapAction, number> = { new: 0, modify: 1, eliminate: 2, keep: 3 };

export const analyzeGaps = (plan: GapPlanPort | undefined, inventory: readonly InventoryItem[]): GapAnalysis => {
  const byId = new Map(inventory.map((i) => [i.id, i]));
  const issues: GapIssue[] = [];
  const entries: GapEntry[] = [];
  const baselineIds = new Set((plan?.baseline ?? []).map((e) => e.itemId));
  const targetById = new Map((plan?.target ?? []).map((e) => [e.itemId, e]));

  for (const itemId of new Set([...baselineIds, ...targetById.keys()])) {
    const item = byId.get(itemId);
    if (!item) {
      if (baselineIds.has(itemId)) issues.push({ kind: 'unresolved-item', itemId, side: 'baseline' });
      if (targetById.has(itemId)) issues.push({ kind: 'unresolved-item', itemId, side: 'target' });
      continue;
    }
    const inBaseline = baselineIds.has(itemId);
    const target = targetById.get(itemId);
    if (inBaseline && !target) entries.push({ itemId, item, action: 'eliminate', changes: [] });
    else if (!inBaseline && target) entries.push({ itemId, item, action: 'new', changes: [] });
    else {
      const changes = changesFor(item, target?.desired);
      entries.push({ itemId, item, action: changes.length ? 'modify' : 'keep', changes });
    }
  }

  entries.sort((a, b) => ORDER[a.action] - ORDER[b.action] || a.item.name.localeCompare(b.item.name));
  const counts: Record<GapAction, number> = { keep: 0, eliminate: 0, new: 0, modify: 0 };
  for (const e of entries) counts[e.action] += 1;
  return { entries, counts, issues };
};
