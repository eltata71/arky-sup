import type { Node } from 'reactflow';
import type { DiagramIR } from '../../lib/diagram';
import type { LayoutQualityMetrics } from './layoutQualityService';
import { inferSemanticDiagramType } from '../../lib/semanticLayoutPolicy';
import { analyzeLayoutReadability } from './diagramReadabilityMetrics';
import { buildLayoutRetryPlan } from './layoutRetryPlanner';
import type { InfiniteCanvasState } from './infiniteCanvasService';

export type VisualGateState = 'ready' | 'warnings' | 'blocked';

export interface VisualGateSignal {
  code: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  recommendation?: string;
  autoAction?: string;
}

export interface VisualQualityGateResult {
  score: number;
  state: VisualGateState;
  signals: VisualGateSignal[];
  recommendedActions: string[];
  safeAutomaticActions: string[];
  rationale: string;
}

export interface VisualQualityGateInput {
  ir: DiagramIR;
  nodes: Node[];
  layoutMetrics?: LayoutQualityMetrics;
  smartFit?: {
    readable: boolean;
    showExploreHint: boolean;
    showViewAllSecondary: boolean;
    reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
  };
  canvasState?: InfiniteCanvasState;
  recentRenderErrors?: number;
  exportPreflightOk?: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function runVisualQualityGate(input: VisualQualityGateInput): VisualQualityGateResult {
  const signals: VisualGateSignal[] = [];
  const diagramType = inferSemanticDiagramType(input.ir);

  if (input.smartFit && !input.smartFit.readable) {
    const reasonMessage = input.smartFit.reason === 'node-too-small'
      ? 'El tamaño visible de nodos cae por debajo del umbral de lectura.'
      : input.smartFit.reason === 'label-too-small'
        ? 'Las etiquetas principales quedan por debajo del umbral legible.'
        : 'El zoom inicial deja nodos/labels por debajo del umbral de lectura.';
    signals.push({
      code: 'INITIAL_ZOOM_ILLEGIBLE',
      severity: 'high',
      message: reasonMessage,
      recommendation: 'Enfocar área principal y dejar “Ver todo” como acción secundaria.',
      autoAction: 'APPLY_FOCUS_PRIMARY_FIT',
    });
  }

  const m = input.layoutMetrics;
  if (m) {
    const readability = analyzeLayoutReadability(m);
    const retryPlan = buildLayoutRetryPlan(m);
    if (readability.readabilityScore < 65) {
      signals.push({
        code: 'LAYOUT_READABILITY_LOW',
        severity: 'high',
        message: `Legibilidad post-layout insuficiente (${readability.readabilityScore}/100).`,
        recommendation: `Aplicar modo ${readability.recommendedMode} y reintentar layout.`,
        autoAction: readability.recommendedActions[0] ?? 'RETRY_LAYOUT_SPACIOUS',
      });
    }
    if (retryPlan.length > 0) {
      signals.push({
        code: 'LAYOUT_RETRY_PLAN_AVAILABLE',
        severity: 'low',
        message: `Plan de reintentos disponible (${retryPlan.length} variante(s)).`,
        recommendation: retryPlan.map((p) => `${p.mode}${p.direction ? `/${p.direction}` : ''}`).join(' → '),
      });
    }
    if (m.excessiveEmptySpace) signals.push({ code: 'EXCESSIVE_WHITESPACE', severity: 'medium', message: 'Exceso de espacio vacío respecto al contenido.', autoAction: 'RETRY_LAYOUT_DENSITY_NORMAL' });
    if (m.overlappingGroupPairs.length > 0) signals.push({ code: 'OVERLAPPING_BOUNDARIES', severity: 'high', message: 'Boundaries/grupos superpuestos detectados.', autoAction: 'RECOMPUTE_GROUP_ZONES' });
    if (m.edgeCrossings >= 8) signals.push({ code: 'EXCESSIVE_EDGE_CROSSINGS', severity: 'medium', message: 'Cruces de edges por encima del umbral recomendado.', autoAction: 'SWITCH_EDGE_ROUTING_ORTHOGONAL' });
    if (m.edgeLabelCollisions.length > 6) signals.push({ code: 'EDGE_LABEL_COLLISIONS', severity: 'medium', message: 'Colisiones de labels de edge afectan legibilidad.', autoAction: 'COLLAPSE_SECONDARY_EDGE_LABELS' });
    if (m.nodesObscuredByObstacles.length > 0) signals.push({ code: 'NODES_OBSCURED', severity: 'high', message: 'Hay nodos ocultos por toolbars/paneles flotantes.', autoAction: 'AUTO_PAN_FROM_OBSTACLE' });
    if (m.edgesCrossingNodes.length > 0) signals.push({ code: 'EDGES_THROUGH_NODES', severity: 'high', message: 'Edges atravesando nodos no-endpoint detectados.', autoAction: 'REROUTE_WITH_OBSTACLE_AVOIDANCE' });
  }

  if (input.canvasState) {
    const logical = input.canvasState.logicalCanvasBounds;
    const content = input.canvasState.contentBounds;
    const fitsWithoutExpand = content.minX >= logical.minX && content.minY >= logical.minY && content.maxX <= logical.maxX && content.maxY <= logical.maxY;
    if (!fitsWithoutExpand && diagramType !== 'generic') {
      signals.push({ code: 'CANVAS_NOT_EXPANDED', severity: 'high', message: 'El contenido requiere expansión de lienzo infinito y no fue aplicada.', autoAction: 'EXPAND_LOGICAL_CANVAS_BOUNDS' });
    }
  }

  if ((input.recentRenderErrors ?? 0) > 0) {
    signals.push({ code: 'RECENT_RENDER_ERRORS', severity: 'high', message: 'Se detectaron errores de render recientes en sesión.', recommendation: 'Usar error boundary granular y reintento de panel.' });
  }

  if (input.exportPreflightOk === false) {
    signals.push({ code: 'EXPORT_PREFLIGHT_FAILED', severity: 'medium', message: 'El preflight de exportación no garantiza salida útil.', autoAction: 'ADJUST_EXPORT_BOUNDS_TO_CONTENT' });
  }

  const penalties = signals.reduce((acc, s) => acc + (s.severity === 'high' ? 18 : s.severity === 'medium' ? 9 : 4), 0);
  const score = clamp(100 - penalties);
  const high = signals.filter((s) => s.severity === 'high').length;
  const state: VisualGateState = high >= 2 || score < 60 ? 'blocked' : (signals.length > 0 ? 'warnings' : 'ready');

  return {
    score,
    state,
    signals,
    recommendedActions: [...new Set(signals.map((s) => s.recommendation).filter((v): v is string => Boolean(v)))],
    safeAutomaticActions: [...new Set([
      ...signals.map((s) => s.autoAction).filter((v): v is string => Boolean(v)),
      ...(m ? buildLayoutRetryPlan(m).map((p) => `RETRY_${p.mode.toUpperCase()}${p.direction ? `_${p.direction}` : ''}`) : []),
    ])],
    rationale: `Visual Gate 2.0 (${diagramType}): ${signals.length === 0 ? 'sin hallazgos críticos' : `${signals.length} hallazgos evaluados`} con score ${score}/100.`,
  };
}
