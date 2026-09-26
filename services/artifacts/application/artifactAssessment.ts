/**
 * Qué se sabe de un artefacto en el lienzo: calidad, preflight, presentación y
 * qué se puede exportar.
 *
 * Este fichero es la capa de aplicación del workspace de artefactos, y existe
 * porque hasta ahora no existía. `components/ArtifactCanvas.tsx` importaba de
 * **ocho módulos de servicio** —IA, diagrama, calidad, exportación, compilador,
 * revisión, artefactos y observabilidad— y encadenaba sus resultados entre dos
 * ramas de JSX. Un componente que importa un servicio está usando una
 * capacidad; uno que importa ocho *es* la capa de aplicación de esa pantalla,
 * escrita en un fichero cuyo trabajo es pintar.
 *
 * ## Por qué son funciones sueltas y no una sola
 *
 * La tentación era exponer un `assessArtifact(todo)` que devolviera un objeto
 * con las seis cosas. Habría sido peor: el lienzo memoiza cada etapa con sus
 * propias dependencias, y colapsarlas en una obligaría a recalcular
 * `analyzeDiagramQuality` —lo más caro que hace esta pantalla— cada vez que el
 * usuario cambia de vista. Modularidad a cambio de trabajo desperdiciado en
 * cada clic no es un buen trato.
 *
 * Así que la composición se declara aquí, etapa a etapa y sin React, y
 * `hooks/artifacts/useArtifactAssessment.ts` pone las fronteras de memoización.
 * Lo que se gana: estas decisiones se pueden probar sin montar un lienzo.
 */

import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { DiagramIR } from '../../../lib/diagram';
import {
  analyzeDiagramQuality,
  buildDiagramPreflightReport,
  type DiagramPreflightReport,
  type DiagramQualityReport,
} from '../../diagram';
import { deriveRuntimeVisualSignals } from '../../diagram/runtimeVisualSignals';
import { enrichSuggestionsWithActions } from '../../diagram/suggestionActions';
import type {
  EdgeSegment,
  FloatingObstacleRect,
  GroupRect,
  NodeRect,
  ViewportRect,
} from '../../diagram/layoutQualityService';
import { getExportFormatOptions, type ArtifactView, type ExportFormat } from '../../export';

// El vocabulario de lo que esta capa devuelve. Las pantallas del lienzo lo
// leen de aquí para no importar de cuatro módulos de servicio sólo para nombrar
// un resultado que reciben de este fichero (F4-05).
export type { ArtifactView, ExportFormat, ExportFormatOption } from '../../export';
export type { DiagramPreflightReport } from '../../diagram';
export type { VisualGateState } from '../../diagram/visualQualityGate';
export type {
  EdgeSegment,
  FloatingObstacleRect,
  GroupRect,
  NodeRect,
  ViewportRect,
} from '../../diagram/layoutQualityService';
export type {
  ArtifactQualityGateResult,
  ArtifactQualityScope,
  ArtifactQualitySeverity,
} from '../../quality';
import {
  buildArtifactExportabilityState,
  evaluateExportQualityGate,
  tierLabel,
  type ArtifactQualityReport,
} from '../../quality';
import {
  buildArchitectureKnowledgeGraphForProject,
  buildArtifactGraphInsight,
  describeArchitectureGraphFreshness,
} from '../../architectureKnowledgeGraph';
import { getCompilationFreshness } from '../../artifactCompiler';
import { buildArtifactSuggestionContext } from '../../ai/artifactSuggestionService';
import { compileArtifactPresentation } from '../domain/artifactPresentationCompiler';
import { deriveHardBlockContext, evaluateGateGuard, gateGuardTone } from '../../diagram/visualGateGuard';
import { isPresentationExportEnabled } from '../domain/artifactPresentationFlags';

/** Lo que el lienzo mide cuando ReactFlow ya ha pintado. */
export interface CanvasLayoutSnapshot {
  nodeRects: NodeRect[];
  groupRects: GroupRect[];
  viewport?: ViewportRect;
  floatingObstacles?: FloatingObstacleRect[];
  edgeSegments?: EdgeSegment[];
  smartViewport?: unknown;
  canvasState?: unknown;
  layoutPlan?: unknown;
}

/**
 * El informe de calidad, recalculado con posiciones reales cuando las hay.
 *
 * Cae al informe que el resolvedor produjo sólo con el IR mientras el lienzo no
 * ha emitido una instantánea, para que el panel siempre tenga *algo* que
 * enseñar. Y captura el fallo: un recálculo que revienta no puede dejar la
 * pantalla sin informe — un panel vacío se lee como «este diagrama no tiene
 * problemas», que es lo contrario de lo que pasó.
 */
export const assessDiagramQuality = (params: {
  artifact: Artifact;
  ir: DiagramIR | null | undefined;
  layout: CanvasLayoutSnapshot | null;
  fallback: DiagramQualityReport | null | undefined;
  lastPreflightReady: boolean | undefined;
}): DiagramQualityReport | null => {
  const { artifact, ir, layout, fallback, lastPreflightReady } = params;
  if (!ir || !layout) return fallback ?? null;
  const runtimeSignals = deriveRuntimeVisualSignals(artifact, lastPreflightReady);
  try {
    return analyzeDiagramQuality(ir, {
      layoutRects: layout.nodeRects,
      groupRects: layout.groupRects,
      viewport: layout.viewport,
      floatingObstacles: layout.floatingObstacles,
      edgeSegments: layout.edgeSegments,
      smartFitDecision: layout.smartViewport as never,
      canvasState: layout.canvasState as never,
      layoutPlan: (layout.layoutPlan ?? undefined) as never,
      recentRenderErrors: runtimeSignals.recentRenderErrors,
      exportPreflightOk: runtimeSignals.exportPreflightOk,
    });
  } catch (error) {
    console.warn('[artifactAssessment] recálculo de calidad con posiciones falló', error);
    return fallback ?? null;
  }
};

/** El preflight de exportación. Sin IR o sin calidad no hay nada que comprobar. */
export const assessPreflight = (
  ir: DiagramIR | null | undefined,
  quality: DiagramQualityReport | null,
): DiagramPreflightReport | null => {
  if (!ir || !quality) return null;
  return buildDiagramPreflightReport(ir, quality, {
    layoutMetrics: quality.layoutMetrics ?? undefined,
  });
};

/**
 * Qué vista de exportación corresponde al modo en pantalla.
 *
 * Excalidraw, Lucidchart y Fable son formas distintas de enseñar el mismo
 * diagrama, así que exportan como diagrama; la vista de publicación exporta
 * como documento. Estaba escrito en una expresión ternaria anidada dentro del
 * cuerpo del componente.
 */
export const resolveExportView = (viewMode: string): ArtifactView => {
  if (viewMode === 'excalidraw' || viewMode === 'lucidchart' || viewMode === 'fable') return 'diagram';
  if (viewMode === 'publication') return 'document';
  return viewMode as ArtifactView;
};

/** Los formatos ofrecidos, incluidos los no disponibles para poder explicarlos. */
export const assessExportFormats = (
  artifact: Artifact,
  activeView: ArtifactView,
  preflight: DiagramPreflightReport | null,
) => getExportFormatOptions({ artifact, activeView, diagramPreflight: preflight, includeUnavailable: true });

/**
 * La foto formal de calidad del artefacto y sus puertas de exportación por
 * familia. Sin vista activa, la del artefacto tal como está guardado — que es lo
 * que el inspector enseña.
 */
export const assessExportability = (artifact: Artifact, activeView?: ArtifactView) =>
  buildArtifactExportabilityState(artifact, activeView ? { activeView } : undefined);

/** La puerta de calidad de un formato concreto, sobre el informe ya calculado. */
export const assessExportGate = (report: ArtifactQualityReport, format: ExportFormat, activeView: ArtifactView) =>
  evaluateExportQualityGate(report, format, activeView);

/**
 * Qué dice el grafo de conocimiento de este artefacto (F4-05).
 *
 * La regla vivía en el inspector: preferir el grafo persistido y, si el
 * proyecto no tiene uno, construirlo en memoria de forma determinista. Un fallo
 * del grafo nunca rompe el panel —es un consumidor periférico—, así que se
 * informa como `null`, igual que «no hay proyecto».
 */
export const assessArtifactKnowledge = (
  project: Project | undefined,
  artifactId: string,
  globalContext: readonly string[] = [],
) => {
  if (!project) return null;
  try {
    const graph = project.architectureKnowledgeGraph
      ?? buildArchitectureKnowledgeGraphForProject(project, { globalContext: [...globalContext] });
    return buildArtifactGraphInsight(graph, artifactId);
  } catch {
    return null;
  }
};

/** La frescura del grafo, en palabras. */
export const describeKnowledgeFreshness = describeArchitectureGraphFreshness;

/** Si la compilación guardada corresponde al contenido actual. */
export const assessCompilationFreshness = (artifact: Artifact) => getCompilationFreshness(artifact);

/** La presentación compilada para la audiencia y el modo actuales. */
export const compilePresentation = (
  artifact: Artifact,
  audience: string,
  viewMode: string,
) => compileArtifactPresentation(artifact, {
  audience: audience === 'executive' || audience === 'technical' || audience === 'operations'
    ? audience
    : 'mixed',
  mode: viewMode === 'publication' ? 'publication' : 'working',
});

/** El contexto que se le manda al modelo para pedirle sugerencias. */
export const buildSuggestionContext = (params: {
  artifact: Artifact;
  project: Project;
  quality: DiagramQualityReport | null;
  settings: Settings;
}) => buildArtifactSuggestionContext(
  {
    artifact: params.artifact,
    project: params.project,
    qualityScore: params.quality?.score ?? null,
    qualitySummary: params.quality?.summary ?? null,
    qualityIssues: (params.quality?.issues ?? []).map(
      (issue) => `[${issue.severity}] ${issue.message} — ${issue.recommendation}`,
    ),
  },
  params.settings,
);

/**
 * Sugerencias del modelo, enriquecidas con las acciones deterministas que se
 * pueden ejecutar.
 *
 * Sin esto el panel ofrece texto; con esto ofrece botones —aplicar ELK, cambiar
 * densidad, regenerar el IR—. Sin IR no hay acción que enriquecer, así que
 * devuelve el informe tal cual en vez de uno vacío.
 */
export const enrichSuggestions = <T extends { suggestions: unknown[] }>(params: {
  report: T | null;
  ir: DiagramIR | null | undefined;
  quality: DiagramQualityReport | null;
  density: 'compact' | 'normal' | 'spacious';
}): T | null => {
  if (!params.report) return null;
  if (!params.ir) return params.report;
  return {
    ...params.report,
    suggestions: enrichSuggestionsWithActions(params.report.suggestions as never, {
      ir: params.ir,
      quality: params.quality,
      currentDirection: 'TB',
      currentDensity: params.density,
    }),
  };
};

/* ── La puerta visual ─────────────────────────────────────────────────────── */
/**
 * Qué permite la puerta de calidad visual para una acción, y cómo debe verse.
 *
 * `evaluateGateGuard` + `gateGuardTone` se llamaban por separado en cuatro
 * sitios —tres en el modal de exportación, uno en el lienzo— y cada uno
 * recomponía a mano la misma regla: si hay bloqueo duro el tono es `block`,
 * si no lo deriva del estado. Cuatro copias de una decisión que cambia cuando
 * cambian los umbrales.
 *
 * `showBanner` recoge la otra mitad: el aviso se enseña cuando la puerta no
 * está lista *o* cuando el bloqueo duro se dispara. Un export visualmente pobre
 * que sale sin avisar es la razón por la que esta puerta existe.
 */
export const assessVisualGate = (
  state: Parameters<typeof gateGuardTone>[0],
  action: Parameters<typeof evaluateGateGuard>[1],
  hardBlockContext: Parameters<typeof evaluateGateGuard>[2],
) => {
  const guard = evaluateGateGuard(state, action, hardBlockContext);
  return {
    guard,
    tone: guard.hardBlock ? ('block' as const) : gateGuardTone(state),
    showBanner: state === 'blocked' || state === 'warnings' || guard.hardBlock,
  };
};

/** El contexto de bloqueo duro derivado del informe de calidad. */
export const assessHardBlockContext = (
  visualGate: Parameters<typeof deriveHardBlockContext>[0],
  options: Parameters<typeof deriveHardBlockContext>[1],
) => deriveHardBlockContext(visualGate, options);

/** La etiqueta legible de un tramo de calidad. */
export const describeQualityTier = (tier: Parameters<typeof tierLabel>[0]) => tierLabel(tier);

/** Si la exportación como publicación está activada en este despliegue. */
export const isPublicationExportEnabled = () => isPresentationExportEnabled();
