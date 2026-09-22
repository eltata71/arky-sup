import type { Artifact } from '../../lib/artifacts';
import type { DiagramPreflightReport } from '../diagram';
import type { ArtifactPresentationModel, PublicationExportMode } from '../../lib/artifacts/artifactPresentationModel';
import {
  getExportCapabilities,
  validateExportRequest,
  type ArtifactView,
  type ExportCapability,
  type ExportFormat,
} from './exportService';
import type { ArtifactValidationResult } from './exportTypes';

export type { ArtifactView, ExportFormat } from './exportService';
export type { ArtifactValidationCheck, ArtifactValidationResult, ValidationSeverity, ValidationScope } from './exportTypes';
export type ExportFormatOption = ExportCapability;

// `isDiagramFormat` / `isTabularFormat` NO se declaran aquí. Este fichero
// traía su propia copia con la lista de formatos escrita a mano —los mismos
// seis que `EXPORT_DEFINITIONS` ya marca con `requiresDiagram` y
// `requiresTable`—, y no la importaba nadie. Dos respuestas a la misma
// pregunta, una de ellas capaz de quedarse atrás en silencio cuando se añada
// un formato. La del registro es la que manda.

export const validateArtifactForExport = (params: {
  artifact: Artifact;
  activeView: ArtifactView;
  format?: ExportFormat;
  diagramPreflight?: DiagramPreflightReport | null;
  presentationModel?: ArtifactPresentationModel | null;
  exportAsPublication?: boolean;
  publicationMode?: PublicationExportMode;
}): ArtifactValidationResult => validateExportRequest({
  artifact: params.artifact,
  activeView: params.activeView,
  diagramPreflight: params.diagramPreflight,
  presentationModel: params.presentationModel,
  exportAsPublication: params.exportAsPublication,
  publicationMode: params.publicationMode,
}, params.format);

export const getExportFormatOptions = (params: {
  artifact: Artifact;
  activeView: ArtifactView;
  diagramPreflight?: DiagramPreflightReport | null;
  includeUnavailable?: boolean;
  presentationModel?: ArtifactPresentationModel | null;
  exportAsPublication?: boolean;
  publicationMode?: PublicationExportMode;
}): ExportCapability[] => getExportCapabilities({
  artifact: params.artifact,
  activeView: params.activeView,
  diagramPreflight: params.diagramPreflight,
  presentationModel: params.presentationModel,
  exportAsPublication: params.exportAsPublication,
  publicationMode: params.publicationMode,
}, params.includeUnavailable ?? true);
