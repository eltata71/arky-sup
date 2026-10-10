/** What a technology says beyond being an inventory item (11.5): its radar ring. Absent means unclassified. */

export const RADAR_RINGS = ['adopt', 'trial', 'assess', 'hold'] as const;
export type RadarRing = (typeof RADAR_RINGS)[number];

export interface TechnologyAttributes {
  readonly ring?: RadarRing;
}

export const isRadarRing = (value: unknown): value is RadarRing => RADAR_RINGS.includes(value as RadarRing);

export const readTechnologyAttributes = (raw: unknown): TechnologyAttributes | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const ring = (raw as Record<string, unknown>).ring;
  return isRadarRing(ring) ? { ring } : undefined;
};
