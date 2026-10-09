/**
 * What leaves the capability map (11.3): one row per capability, in reading
 * order, with the layer's value in words. The words come from the caller —
 * this module knows no language — and an unmeasured value stays the caller's
 * "sin medir", never a 0.
 */

import { flattenCapabilityMap, type CapabilityLayer, type CapabilityMap, type LayerValue } from './capabilityMap';

export interface CapabilityExportRow {
  readonly level: number;
  readonly name: string;
  readonly value: string;
  /** 0..1, `null` when the layer has nothing measured for this capability. */
  readonly intensity: number | null;
  readonly applications: readonly string[];
  readonly initiativeCount: number;
}

export const buildCapabilityExportRows = (
  map: CapabilityMap,
  layer: CapabilityLayer,
  describe: (layer: CapabilityLayer, value: LayerValue) => string,
): CapabilityExportRow[] =>
  flattenCapabilityMap(map).map((node) => ({
    level: node.level,
    name: node.item.name,
    value: describe(layer, node.layers[layer]),
    intensity: node.layers[layer].intensity,
    applications: node.supportingApplications.map((a) => a.name),
    initiativeCount: node.initiativeIds.length,
  }));
