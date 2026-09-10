import { classifyArtifact } from '../../lib/artifacts/artifactClassification';
import { isPresentationArtifactType, getArtifactKind, getPreferredExports } from '../../lib/artifacts/artifactKind';
import type { ExportCapability, ExportFormat, ExportFormatDefinition, ExportContext, ArtifactView } from './exportTypes';
import { parseMarkdownTables } from '../../lib/markdownTables';

export const EXPORT_DEFINITIONS: Record<ExportFormat, ExportFormatDefinition> = {
  md: { format: 'md', extension: 'md', mimeType: 'text/markdown;charset=utf-8', label: 'Markdown (.md)', description: 'Contenido fuente preservado en UTF-8.', category: 'Documento', implemented: true },
  html: { format: 'html', extension: 'html', mimeType: 'text/html;charset=utf-8', label: 'HTML imprimible', description: 'Documento HTML completo con estilos embebidos y tablas legibles.', category: 'Documento', implemented: true },
  txt: { format: 'txt', extension: 'txt', mimeType: 'text/plain;charset=utf-8', label: 'Texto (.txt)', description: 'Texto plano legible para auditoría o intercambio.', category: 'Intercambio/Auditoría', implemented: true },
  pdf: { format: 'pdf', extension: 'pdf', mimeType: 'application/pdf', label: 'PDF real (.pdf)', description: 'PDF descargable con encabezado válido y paginación básica.', category: 'Documento', implemented: true, producesBinary: true },
  docx: { format: 'docx', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word / Google Docs compatible (.docx)', description: 'Paquete OOXML real compatible con Word, Apple Files y Google Docs.', category: 'Documento', implemented: true, producesBinary: true },
  csv: { format: 'csv', extension: 'csv', mimeType: 'text/csv;charset=utf-8', label: 'CSV UTF-8 (.csv)', description: 'Tabla con BOM UTF-8 compatible con Excel y Google Sheets.', category: 'Hoja de cálculo', implemented: true, requiresTable: true },
  xlsx: { format: 'xlsx', extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel / Google Sheets compatible (.xlsx)', description: 'Libro OOXML real para matrices y tablas.', category: 'Hoja de cálculo', implemented: true, requiresTable: true, producesBinary: true },
  json: { format: 'json', extension: 'json', mimeType: 'application/json;charset=utf-8', label: 'JSON técnico', description: 'Contenido, clasificación y metadatos para trazabilidad.', category: 'Intercambio/Auditoría', implemented: true },
  png: { format: 'png', extension: 'png', mimeType: 'image/png', label: 'PNG (imagen)', description: 'Captura raster del diagrama visible.', category: 'Diagrama', implemented: true, requiresDiagram: true, producesBinary: true },
  svg: { format: 'svg', extension: 'svg', mimeType: 'image/svg+xml', label: 'SVG (vectorial)', description: 'Captura vectorial del diagrama visible.', category: 'Diagrama', implemented: true, requiresDiagram: true },
  mermaid: { format: 'mermaid', extension: 'mmd', mimeType: 'text/plain;charset=utf-8', label: 'Mermaid (.mmd)', description: 'Código Mermaid del diagrama.', category: 'Diagrama', implemented: true, requiresDiagram: true },
  'diagram-json': { format: 'diagram-json', extension: 'diagram.json', mimeType: 'application/json;charset=utf-8', label: 'JSON de diagrama', description: 'IR de nodos y aristas para auditoría técnica.', category: 'Diagrama', implemented: true, requiresDiagram: true },
  pptx: { format: 'pptx', extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint / Google Slides compatible (.pptx)', description: 'Paquete OOXML real con una slide por diapositiva del deck. Abre en PowerPoint, Keynote y Google Slides.', category: 'Presentación', implemented: true, requiresPresentation: true, producesBinary: true },
};

const DOCUMENT_FORMATS: readonly ExportFormat[] = ['md', 'html', 'txt', 'pdf', 'docx', 'json'];
const TABLE_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx'];
const DIAGRAM_FORMATS: readonly ExportFormat[] = ['png', 'svg', 'mermaid', 'diagram-json'];
const PRESENTATION_FORMATS: readonly ExportFormat[] = ['pptx', 'pdf', 'html', 'json'];
const unique = <T,>(items: readonly T[]): T[] => Array.from(new Set(items));

export const normalizeExportView = (view: ArtifactView): ArtifactView => (view === 'excalidraw' || view === 'lucidchart' ? 'diagram' : view);
export const isDiagramFormat = (format: ExportFormat): boolean => Boolean(EXPORT_DEFINITIONS[format]?.requiresDiagram);
export const isTabularFormat = (format: ExportFormat): boolean => Boolean(EXPORT_DEFINITIONS[format]?.requiresTable);

export function getCandidateFormats(context: Pick<ExportContext, 'artifact' | 'activeView' | 'exportAsPublication' | 'presentationModel' | 'publicationMode'>): ExportFormat[] {
  if (context.exportAsPublication && context.presentationModel) {
    const hasDocument = context.presentationModel.sections.length > 0 || Boolean(context.presentationModel.executiveSummary);
    const hasDiagram = context.presentationModel.diagrams.some((diagram) => diagram.nodeCount > 0 || Boolean(diagram.mermaid));
    const hasTables = context.presentationModel.tables.some((table) => table.headers.length > 0 && table.rows.length > 0);
    if (context.publicationMode === 'diagram-only') return hasDiagram ? [...DIAGRAM_FORMATS, 'html', 'md', 'pdf', 'docx', 'json'] : [];
    if (context.publicationMode === 'table-only') return hasTables ? unique([...TABLE_FORMATS, 'html', 'md', 'json']) : [];
    return unique([...(hasDocument ? DOCUMENT_FORMATS : []), ...(hasDiagram ? DIAGRAM_FORMATS : []), ...(hasTables ? TABLE_FORMATS : [])]);
  }
  // Presentation artifacts get their own format universe: PPTX is the
  // primary export, PDF/HTML/JSON are secondary. DOCX is intentionally
  // demoted because a slide deck should not be primarily delivered as a
  // long Word document.
  if (isPresentationArtifactType(context.artifact.type)) {
    return [...PRESENTATION_FORMATS];
  }
  const classification = classifyArtifact(context.artifact);
  const view = normalizeExportView(context.activeView);
  if (view === 'diagram') return classification.hasDiagram ? [...DIAGRAM_FORMATS] : [];
  const base = view === 'split' && classification.hasDiagram ? unique([...DOCUMENT_FORMATS, ...DIAGRAM_FORMATS]) : [...DOCUMENT_FORMATS];
  const tableAware = classification.hasTables || classification.isDataDictionary || parseMarkdownTables(context.artifact.content).length > 0;
  return tableAware ? unique([...base, ...TABLE_FORMATS]) : base;
}

export function getExportCapabilities(context: Pick<ExportContext, 'artifact' | 'activeView' | 'diagramPreflight' | 'exportAsPublication' | 'presentationModel' | 'publicationMode'>, includeUnavailable = true): ExportCapability[] {
  const classification = classifyArtifact(context.artifact);
  const isPresentation = isPresentationArtifactType(context.artifact.type);
  const tables = parseMarkdownTables(context.artifact.content);
  const candidates = getCandidateFormats(context);
  const universe = isPresentation
    ? unique([...candidates, ...PRESENTATION_FORMATS])
    : unique([...candidates, ...DOCUMENT_FORMATS, ...TABLE_FORMATS, ...DIAGRAM_FORMATS]);
  return universe.map((format) => {
    const definition = EXPORT_DEFINITIONS[format];
    const inCandidate = candidates.includes(format);
    const hasPublicationContent = Boolean(context.exportAsPublication && context.presentationModel);
    let enabled = definition.implemented && inCandidate && (context.artifact.content.trim().length > 0 || hasPublicationContent);
    let reason: string | undefined;
    if (!definition.implemented) reason = 'Este formato no tiene un exportador real implementado.';
    else if (!inCandidate) reason = `No aplica para la vista ${normalizeExportView(context.activeView)} y el tipo ${classification.primaryKind}.`;
    else if (!context.artifact.content.trim() && !hasPublicationContent) reason = 'No hay contenido exportable.';
    else if (definition.requiresDiagram && !classification.hasDiagram) reason = 'Este artefacto no contiene un diagrama exportable.';
    else if (definition.requiresTable && tables.length === 0 && !classification.hasTables) reason = 'No se detectó una tabla Markdown o matriz exportable.';
    else if (definition.requiresPresentation && !isPresentation) reason = 'Este formato sólo aplica a artefactos tipo presentación.';
    if (reason) enabled = false;
    return { format, extension: definition.extension, mimeType: definition.mimeType, label: definition.label, description: definition.description, group: definition.category, category: definition.category, implemented: definition.implemented, enabled, reason };
  }).filter((capability) => includeUnavailable || capability.enabled);
}

/**
 * Preferred export formats for an artifact, in priority order. The export
 * modal can use this to surface the right primary format per kind (e.g.
 * PPTX for presentations, DOCX for documents, PNG/SVG for diagrams).
 */
export function getPreferredExportsForArtifact(context: Pick<ExportContext, 'artifact'>): readonly ExportFormat[] {
  const kind = getArtifactKind(context.artifact.type);
  return getPreferredExports(kind);
}
