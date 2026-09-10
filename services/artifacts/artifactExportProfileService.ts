import type { Artifact } from '../../types';
import type { ExportFormat } from '../export/exportTypes';
import type { ArtifactExportProfile, ArtifactPresentationQuality } from '../../lib/artifacts/artifactPresentationModel';
import { isPresentationExportEnabled } from './artifactPresentationFlags';

export interface ResolveArtifactExportProfileInput {
  artifact: Artifact;
  hasDocument: boolean;
  hasDiagram: boolean;
  hasTables: boolean;
  quality?: ArtifactPresentationQuality;
}

const implementedDocumentFormats: ExportFormat[] = ['pdf', 'docx', 'html', 'md', 'txt', 'json'];
const implementedDiagramFormats: ExportFormat[] = ['svg', 'png', 'mermaid', 'diagram-json'];
const implementedTableFormats: ExportFormat[] = ['xlsx', 'csv', 'html', 'md', 'json'];
const unique = <T,>(items: readonly T[]): T[] => Array.from(new Set(items));

export const resolveArtifactExportProfile = (input: ResolveArtifactExportProfileInput): ArtifactExportProfile => {
  const available = new Set<ExportFormat>();
  const recommended: ExportFormat[] = [];
  const blockedFormats: ArtifactExportProfile['blockedFormats'] = [];
  const presentationExportEnabled = isPresentationExportEnabled();
  const isHybrid = input.hasDocument && input.hasDiagram;

  if (input.hasDocument) implementedDocumentFormats.forEach((format) => available.add(format));
  if (input.hasDiagram) implementedDiagramFormats.forEach((format) => available.add(format));
  if (input.hasTables) implementedTableFormats.forEach((format) => available.add(format));

  if (input.hasTables && !input.hasDocument && !input.hasDiagram) recommended.push('xlsx', 'csv', 'html', 'md');
  else if (isHybrid) recommended.push('pdf', 'html', 'docx', 'md', 'svg', 'png');
  else if (input.hasDiagram) recommended.push('svg', 'png', 'mermaid', 'diagram-json');
  else if (input.hasDocument) recommended.push('pdf', 'docx', 'html', 'md');
  if (input.hasTables && !recommended.includes('xlsx')) recommended.push('xlsx', 'csv');

  if (!input.hasDocument) {
    implementedDocumentFormats.filter((format) => !['json'].includes(format)).forEach((format) => blockedFormats.push({
      format,
      reason: 'El modelo de publicación no contiene secciones documentales suficientes.',
      recommendation: 'Genere contenido documental o exporte sólo diagrama/JSON técnico.',
    }));
  }
  if (!input.hasDiagram) {
    implementedDiagramFormats.forEach((format) => blockedFormats.push({
      format,
      reason: 'El artefacto no contiene un diagrama renderizable.',
      recommendation: 'Use vista documental o regenere un diagrama con Mermaid/IR.',
    }));
  }
  if (!input.hasTables) {
    (['csv', 'xlsx'] as ExportFormat[]).forEach((format) => blockedFormats.push({
      format,
      reason: 'No se detectaron tablas o matrices.',
      recommendation: 'Agregue una tabla Markdown con encabezados para habilitar exportación tabular.',
    }));
  }
  if (!presentationExportEnabled) {
    (['pdf', 'docx', 'html', 'md'] as ExportFormat[]).forEach((format) => blockedFormats.push({
      format,
      reason: 'La exportación basada en presentación está deshabilitada por feature flag.',
      recommendation: 'Active VITE_PRESENTATION_EXPORT_ENABLED para ofrecer versión publicación.',
    }));
  }

  const availableFormats = Array.from(available);
  const recommendedFormats = unique(recommended).filter((format) => available.has(format));
  const defaultFormat = recommendedFormats[0] ?? availableFormats[0] ?? 'json';
  const hasCriticalBlockers = (input.quality?.blockers.length ?? 0) > 0;

  return {
    recommendedFormats,
    availableFormats,
    blockedFormats,
    defaultFormat,
    canExportAsPublication: presentationExportEnabled && availableFormats.length > 0 && !hasCriticalBlockers,
    requiresUserReview: Boolean(input.quality && (!input.quality.readyForPublication || input.quality.warnings.length > 0 || hasCriticalBlockers)),
  };
};
