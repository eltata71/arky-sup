import type { LayoutQualityMetrics } from './layoutQualityService';
import type { LayoutDensityMode } from './diagramReadabilityMetrics';

export interface LayoutRetryPlan {
  mode: LayoutDensityMode;
  direction?: 'LR' | 'TB';
  reason: string;
  splitIntoSections?: boolean;
}

/**
 * Deterministic retry planner for Top-4: transforms layout metrics into a
 * finite sequence of safe relayout attempts. Pure function.
 */
export function buildLayoutRetryPlan(metrics: LayoutQualityMetrics): LayoutRetryPlan[] {
  const plans: LayoutRetryPlan[] = [];

  if (metrics.overlappingNodePairs.length > 0 || metrics.density > 0.52) {
    plans.push({ mode: 'spacious', reason: 'Solapes o densidad alta; ampliar separación.' });
  }
  if (metrics.excessiveEmptySpace || metrics.density < 0.08) {
    plans.push({ mode: 'compact', reason: 'Whitespace excesivo; compactar conservando legibilidad.' });
  }
  if (metrics.edgeCrossings > 12) {
    plans.push({ mode: 'normal', direction: 'TB', reason: 'Cruces altos; intentar dirección TB.' });
    plans.push({ mode: 'normal', direction: 'LR', reason: 'Cruces altos; fallback dirección LR.' });
  }
  if (metrics.nodesOutsideViewport.length > 0 || metrics.aspectStrip !== null) {
    plans.push({ mode: 'infinite-canvas', reason: 'Contenido fuera de viewport o layout en franja.' });
  }

  if (metrics.edgeCrossings > 24 || metrics.overlappingGroupPairs.length > 2) {
    plans.push({
      mode: 'spacious',
      direction: 'LR',
      splitIntoSections: true,
      reason: 'Complejidad visual extrema; dividir en secciones navegables y reintentar por bloques.',
    });
  }

  // de-dup stable by mode+direction
  const seen = new Set<string>();
  return plans.filter((p) => {
    const key = `${p.mode}::${p.direction ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

