/**
 * Technology radar (11.5): Adoptar, Probar, Evaluar, Retener.
 *
 * The ring is declared on the technology; this reads it, never picks one. A
 * technology without a ring is «sin clasificar». The Office's standards arrive
 * through a port, so this context imports no Office: the radar only lists, next
 * to each technology, the standards that name it, as evidence for whoever rings it.
 */

import { normalizeInventoryName } from '../domain/inventoryNames';
import type { InventoryItem } from '../domain/InventoryTypes';
import { RADAR_RINGS, type RadarRing } from '../domain/technologyAttributes';

export interface RadarStandard {
  readonly id: string;
  readonly domain: string;
  readonly statement: string;
}

export interface TechnologyRadarEntry {
  readonly item: InventoryItem;
  /** `null` = sin clasificar. */
  readonly ring: RadarRing | null;
  readonly standards: readonly RadarStandard[];
}

export interface TechnologyRadar {
  readonly entries: readonly TechnologyRadarEntry[];
  readonly byRing: Readonly<Record<RadarRing, readonly TechnologyRadarEntry[]>>;
  readonly unclassified: readonly TechnologyRadarEntry[];
  /** How many standards the Office handed over, to tell "none mention it" from "none were given". */
  readonly standardsCount: number;
}

const mentions = (statement: string, names: readonly string[]): boolean => {
  const haystack = ` ${normalizeInventoryName(statement)} `;
  return names.some((n) => {
    const key = normalizeInventoryName(n);
    return key.length >= 3 && haystack.includes(` ${key} `);
  });
};

export const buildTechnologyRadar = (
  items: readonly InventoryItem[],
  standards: readonly RadarStandard[],
): TechnologyRadar => {
  const entries = items
    .filter((i) => i.kind === 'technology' && i.lifecycle !== 'retired')
    .map<TechnologyRadarEntry>((item) => ({
      item,
      ring: item.technology?.ring ?? null,
      standards: standards.filter((s) => mentions(s.statement, [item.name, ...item.aliases])),
    }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name, 'es'));
  const byRing = Object.fromEntries(RADAR_RINGS.map((r) => [r, [] as TechnologyRadarEntry[]])) as Record<RadarRing, TechnologyRadarEntry[]>;
  const unclassified: TechnologyRadarEntry[] = [];
  for (const entry of entries) {
    if (entry.ring) byRing[entry.ring].push(entry);
    else unclassified.push(entry);
  }
  return { entries, byRing, unclassified, standardsCount: standards.length };
};
