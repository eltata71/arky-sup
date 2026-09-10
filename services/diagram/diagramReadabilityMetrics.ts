import type { LayoutQualityMetrics } from './layoutQualityService';

export type LayoutDensityMode = 'compact' | 'normal' | 'spacious' | 'infinite-canvas';

export interface LayoutReadabilityAssessment {
  readabilityScore: number;
  densityScore: number;
  recommendedMode: LayoutDensityMode;
  recommendedActions: string[];
  rationale: string;
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

export function scoreLayoutDensity(metrics: LayoutQualityMetrics): number {
  let score = 100;
  if (metrics.excessiveEmptySpace) score -= 18;
  if (metrics.density > 0.52) score -= 20;
  if (metrics.density < 0.08) score -= 12;
  if (metrics.edgeCrossings > 12) score -= 15;
  if (metrics.edgeLabelCollisions.length > 8) score -= 10;
  if (metrics.overlappingNodePairs.length > 0) score -= 24;
  return clamp(score);
}

export function analyzeLayoutReadability(metrics: LayoutQualityMetrics): LayoutReadabilityAssessment {
  const densityScore = scoreLayoutDensity(metrics);
  let readabilityScore = densityScore;
  readabilityScore -= metrics.nodesOutsideViewport.length > 0 ? 10 : 0;
  readabilityScore -= metrics.nodesObscuredByObstacles.length > 0 ? 10 : 0;
  readabilityScore = clamp(readabilityScore);

  const recommendedActions: string[] = [];
  let recommendedMode: LayoutDensityMode = 'normal';
  if (metrics.overlappingNodePairs.length > 0 || metrics.density > 0.52) {
    recommendedMode = 'spacious';
    recommendedActions.push('RETRY_LAYOUT_SPACIOUS');
  } else if (metrics.excessiveEmptySpace || metrics.density < 0.08) {
    recommendedMode = 'compact';
    recommendedActions.push('RETRY_LAYOUT_COMPACT');
  }
  if (metrics.nodesOutsideViewport.length > 0 || metrics.aspectStrip !== null) {
    recommendedMode = 'infinite-canvas';
    recommendedActions.push('ENABLE_INFINITE_CANVAS_EXPLORATION');
  }
  if (metrics.edgeCrossings > 12) recommendedActions.push('RETRY_LAYOUT_ALTERNATE_DIRECTION');
  if (metrics.edgeLabelCollisions.length > 8) recommendedActions.push('REDUCE_SECONDARY_LABELS');

  return {
    readabilityScore,
    densityScore,
    recommendedMode,
    recommendedActions: Array.from(new Set(recommendedActions)),
    rationale: `Readability ${readabilityScore}/100, density ${densityScore}/100.`,
  };
}

