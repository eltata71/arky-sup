import type { DiagramIR } from './diagram';
import type { DiagramDensity } from './diagram';
import type { LayoutPlan } from './layoutSelector';

export type SemanticDiagramType =
  | 'c4-context'
  | 'c4-container'
  | 'integration'
  | 'bpmn'
  | 'value-stream'
  | 'deployment'
  | 'data-flow'
  | 'generic';

export interface SemanticLayoutPolicy extends Pick<LayoutPlan, 'backend' | 'algorithm' | 'direction' | 'density' | 'orthogonal'> {
  diagramType: SemanticDiagramType;
  padding: number;
  groupStrategy: 'swimlanes' | 'hierarchical-boundaries' | 'zones' | 'none';
  edgeStrategy: 'orthogonal' | 'lanes' | 'bpmn' | 'curved';
  fitStrategy: 'focus-primary' | 'fit-content';
  requiresExpandedCanvas: boolean;
  rationale: string;
}

const byType: Record<SemanticDiagramType, Omit<SemanticLayoutPolicy, 'diagramType'>> = {
  'c4-context': { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'normal', orthogonal: true, padding: 96, groupStrategy: 'zones', edgeStrategy: 'orthogonal', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'C4 context prioriza un sistema central con actores alrededor y relaciones ortogonales claras.' },
  'c4-container': { backend: 'elk', algorithm: 'layered', direction: 'TB', density: 'normal', orthogonal: true, padding: 84, groupStrategy: 'hierarchical-boundaries', edgeStrategy: 'orthogonal', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'C4 container/component necesita capas y dependencias direccionadas.' },
  integration: { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'spacious', orthogonal: true, padding: 104, groupStrategy: 'swimlanes', edgeStrategy: 'lanes', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'Integración requiere carriles origen → middleware → destino y separación de externos.' },
  bpmn: { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'normal', orthogonal: true, padding: 100, groupStrategy: 'swimlanes', edgeStrategy: 'bpmn', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'BPMN debe renderizarse left-to-right con pools/lanes.' },
  'value-stream': { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'spacious', orthogonal: true, padding: 112, groupStrategy: 'swimlanes', edgeStrategy: 'lanes', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'Value stream prioriza flujo horizontal por etapas.' },
  deployment: { backend: 'elk', algorithm: 'mrtree', direction: 'TB', density: 'normal', orthogonal: true, padding: 96, groupStrategy: 'hierarchical-boundaries', edgeStrategy: 'orthogonal', fitStrategy: 'fit-content', requiresExpandedCanvas: true, rationale: 'Deployment requiere zonas jerárquicas de infraestructura.' },
  'data-flow': { backend: 'elk', algorithm: 'layered', direction: 'LR', density: 'normal', orthogonal: true, padding: 92, groupStrategy: 'zones', edgeStrategy: 'orthogonal', fitStrategy: 'focus-primary', requiresExpandedCanvas: true, rationale: 'Data flow comunica productores → procesamiento → almacenamiento → consumidores.' },
  generic: { backend: 'dagre', algorithm: 'layered', direction: 'TB', density: 'normal', orthogonal: false, padding: 72, groupStrategy: 'none', edgeStrategy: 'curved', fitStrategy: 'fit-content', requiresExpandedCanvas: false, rationale: 'Fallback genérico para diagramas sin semántica detectable.' },
};

export const inferSemanticDiagramType = (ir: DiagramIR): SemanticDiagramType => {
  const type = String(ir.metadata?.diagramType ?? ir.metadata?.sourceFormat ?? '').toLowerCase();
  if (type.includes('context')) return 'c4-context';
  if (type.includes('container') || type.includes('component')) return 'c4-container';
  if (type.includes('integration')) return 'integration';
  if (type.includes('bpmn')) return 'bpmn';
  if (type.includes('value') || type.includes('vsm')) return 'value-stream';
  if (type.includes('deploy')) return 'deployment';
  if (type.includes('data-flow') || type.includes('flow')) return 'data-flow';
  return 'generic';
};

/**
 * Size-aware adjustments applied on top of the per-type base policy.
 *
 *  - C4 container/component diagrams with many nodes (≥ 15) flip to a
 *    compact density so the layers stay legible without scrolling
 *    indefinitely.
 *  - Integration archetypes with > 18 nodes flip to TB so the swimlanes
 *    don't degrade into a single very-wide row that the user can't read
 *    without horizontal scrolling.
 *
 * Returned alongside the base policy so callers can decide whether to
 * surface the adjustment in the rationale.
 */
const applySizeAwareAdjustments = (
  base: Omit<SemanticLayoutPolicy, 'diagramType'>,
  diagramType: SemanticDiagramType,
  nodeCount: number,
): { density: SemanticLayoutPolicy['density']; direction: SemanticLayoutPolicy['direction']; adjusted: string[] } => {
  const adjusted: string[] = [];
  let density = base.density;
  let direction = base.direction;
  if (diagramType === 'c4-container' && nodeCount >= 15) {
    density = 'compact';
    adjusted.push(`c4-container ≥15 nodos → densidad compact`);
  }
  if (diagramType === 'integration' && nodeCount > 18) {
    direction = 'TB';
    adjusted.push(`integration >18 nodos → dirección TB`);
  }
  return { density, direction, adjusted };
};

export const resolveSemanticLayoutPolicy = (
  ir: DiagramIR,
  userOverride?: Partial<Pick<SemanticLayoutPolicy, 'direction' | 'density'>>,
): { policy: SemanticLayoutPolicy; warnings: string[] } => {
  const diagramType = inferSemanticDiagramType(ir);
  const base = byType[diagramType];
  const warnings: string[] = [];
  const sized = applySizeAwareAdjustments(base, diagramType, ir.nodes.length);
  const density = userOverride?.density ?? sized.density;
  const direction = userOverride?.direction ?? sized.direction;
  const rationale = sized.adjusted.length > 0
    ? `${base.rationale} Ajustes: ${sized.adjusted.join(', ')}.`
    : base.rationale;

  if (userOverride?.density && diagramType !== 'generic') {
    const penalized = (userOverride.density as DiagramDensity) === 'compact' && (diagramType === 'bpmn' || diagramType === 'integration' || diagramType === 'value-stream');
    if (penalized) warnings.push('El override de densidad compact puede degradar legibilidad para este tipo de diagrama.');
  }

  return {
    policy: { diagramType, ...base, density, direction, rationale },
    warnings,
  };
};
