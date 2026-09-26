import type { Artifact } from '../../../lib/artifacts';
import type { ArtifactPresentationModel, ArtifactPresentationQuality } from '../../../lib/artifacts/artifactPresentationModel';
import { detectArtifactFallbackContent } from './artifactFallbackDetection';

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const average = (values: number[]): number => clamp(values.reduce((sum, item) => sum + item, 0) / Math.max(values.length, 1));

export const looksLikeSkeletonFallback = (content: string, artifact?: Pick<Artifact, 'rawResponse' | 'lastDiagramError' | 'generationTrace' | 'ir'>): boolean =>
  detectArtifactFallbackContent({
    content,
    rawResponse: artifact?.rawResponse,
    lastDiagramError: artifact?.lastDiagramError,
    generationTraceStatus: artifact?.generationTrace?.status,
    irMetadata: artifact?.ir?.metadata as Record<string, unknown> | undefined,
  }).isFallback || /skeleton|esqueleto/i.test(content) && /placeholder|pendiente de completar|todo:/i.test(content);

export const evaluateArtifactPresentationQuality = (model: Omit<ArtifactPresentationModel, 'quality'>, sourceContent = '', sourceArtifact?: Pick<Artifact, 'rawResponse' | 'lastDiagramError' | 'generationTrace' | 'ir'>): ArtifactPresentationQuality => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const hasUsefulContent = Boolean(
    model.sections.some((section) => section.content.trim().length > 30)
    || model.diagrams.some((diagram) => diagram.nodeCount > 0)
    || model.tables.some((table) => table.rows.length > 0),
  );

  if (!hasUsefulContent) blockers.push('No hay contenido útil suficiente para publicar.');
  if (model.diagrams.some((diagram) => diagram.nodeCount === 0)) blockers.push('Un diagrama no tiene nodos detectables.');
  if (looksLikeSkeletonFallback(sourceContent, sourceArtifact)) blockers.push('El contenido parece un skeleton/fallback y requiere regeneración o edición antes de publicación profesional.');

  if (!model.executiveSummary?.trim()) warnings.push('Falta resumen ejecutivo explícito.');
  if (model.nextSteps.length === 0) warnings.push('Faltan próximos pasos accionables.');
  if (model.traceability.length === 0) warnings.push('Falta trazabilidad explícita.');
  if (model.diagrams.some((diagram) => diagram.legend.length === 0)) warnings.push('Un diagrama no tiene leyenda de lectura.');
  if (model.diagrams.some((diagram) => !diagram.exportSafe)) warnings.push('Un diagrama requiere ajustes visuales antes de exportación ejecutiva.');
  if (model.tables.some((table) => table.completeness < 0.85)) warnings.push('Una tabla tiene completitud baja.');

  if (warnings.length > 0) recommendations.push('Completar las advertencias antes de enviar a comité o auditoría.');
  if (model.diagrams.some((diagram) => diagram.density === 'overloaded')) recommendations.push('Dividir diagramas sobrecargados por dominio, flujo o nivel C4.');
  if (model.sections.length < 3 && model.artifactType !== 'react-flow-graph') recommendations.push('Agregar estructura con propósito, alcance, decisiones y próximos pasos.');

  const dimensions = {
    structure: clamp(45 + Math.min(model.sections.length, 8) * 7 + (model.executiveSummary ? 10 : 0)),
    readability: clamp(70 - model.sections.filter((section) => section.content.length > 1800).length * 15 - warnings.length * 3),
    visualHierarchy: clamp(50 + Math.min(model.sections.length + model.diagrams.length + model.tables.length, 6) * 8),
    traceability: clamp(model.traceability.length > 0 ? 82 : 48),
    exportReadiness: clamp(90 - blockers.length * 35 - model.diagrams.filter((diagram) => !diagram.exportSafe).length * 18 - model.tables.filter((table) => !table.exportSafe).length * 12),
    audienceAlignment: clamp(model.audience === 'mixed' ? 78 : 84),
  };
  const score = average(Object.values(dimensions)) - blockers.length * 10;

  return {
    score: clamp(score),
    readyForPublication: blockers.length === 0 && clamp(score) >= 70,
    blockers,
    warnings,
    recommendations,
    dimensions,
  };
};
