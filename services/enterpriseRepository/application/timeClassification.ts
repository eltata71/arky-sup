/**
 * TIME rationalisation (11.5): Tolerar, Invertir, Migrar, Eliminar.
 *
 * The quadrant is computed from two measured axes, never chosen. Without both
 * scores the application is «sin evaluar» (`null`): a missing score is not a
 * low one, and a default quadrant would be an opinion shaped like a measurement.
 */

import type { FitScore } from '../domain/applicationAttributes';
import type { InventoryItem } from '../domain/InventoryTypes';

export type TimeQuadrant = 'tolerate' | 'invest' | 'migrate' | 'eliminate';

export const TIME_QUADRANTS: readonly TimeQuadrant[] = ['invest', 'migrate', 'tolerate', 'eliminate'];

/** A score at or above this is "high" on its axis. */
export const TIME_HIGH_THRESHOLD = 3;

/**
 * high functional + high technical → invest; high functional + low technical →
 * migrate; low functional + high technical → tolerate; low + low → eliminate.
 */
export const classifyTime = (functionalFit: FitScore | undefined, technicalFit: FitScore | undefined): TimeQuadrant | null => {
  if (functionalFit === undefined || technicalFit === undefined) return null;
  const functionalHigh = functionalFit >= TIME_HIGH_THRESHOLD;
  const technicalHigh = technicalFit >= TIME_HIGH_THRESHOLD;
  if (functionalHigh) return technicalHigh ? 'invest' : 'migrate';
  return technicalHigh ? 'tolerate' : 'eliminate';
};

export interface ApplicationTimeEntry {
  readonly item: InventoryItem;
  readonly functionalFit: FitScore | null;
  readonly technicalFit: FitScore | null;
  /** `null` = sin evaluar. */
  readonly quadrant: TimeQuadrant | null;
}

export interface ApplicationPortfolio {
  readonly entries: readonly ApplicationTimeEntry[];
  readonly byQuadrant: Readonly<Record<TimeQuadrant, readonly ApplicationTimeEntry[]>>;
  readonly unassessed: readonly ApplicationTimeEntry[];
  readonly assessedCount: number;
}

/** Retired applications are history, not portfolio: they are left out. */
export const buildApplicationPortfolio = (items: readonly InventoryItem[]): ApplicationPortfolio => {
  const entries = items
    .filter((i) => i.kind === 'application' && i.lifecycle !== 'retired')
    .map<ApplicationTimeEntry>((item) => ({
      item,
      functionalFit: item.application?.functionalFit ?? null,
      technicalFit: item.application?.technicalFit ?? null,
      quadrant: classifyTime(item.application?.functionalFit, item.application?.technicalFit),
    }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name, 'es'));
  const byQuadrant: Record<TimeQuadrant, ApplicationTimeEntry[]> = { invest: [], migrate: [], tolerate: [], eliminate: [] };
  const unassessed: ApplicationTimeEntry[] = [];
  for (const entry of entries) {
    if (entry.quadrant) byQuadrant[entry.quadrant].push(entry);
    else unassessed.push(entry);
  }
  return { entries, byQuadrant, unassessed, assessedCount: entries.length - unassessed.length };
};
