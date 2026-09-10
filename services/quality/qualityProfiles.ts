/**
 * Quality profiles per artifact type.
 *
 * A profile describes:
 *  - which dimensions are evaluated (with weights summing to ~100),
 *  - which family the profile belongs to (used for repair routing),
 *  - the score thresholds that map onto user-facing tiers.
 *
 * When a new artifact type is added, declare a profile here and the
 * orchestrator will pick it up automatically. The default profile keeps the
 * pipeline safe for unknown types.
 */

import type { ArtifactType } from '../../types';
import type { ArtifactQualityProfile } from './artifactQualityModel';

type DimensionSpec = Omit<ArtifactQualityProfile['dimensions'][number], 'detail' | 'score'>;

const DOC_BASE_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'doc.headings', label: 'Estructura de encabezados', scope: 'document', weight: 8 },
  { id: 'doc.objective', label: 'Objetivo', scope: 'document', weight: 7 },
  { id: 'doc.scope', label: 'Alcance', scope: 'document', weight: 7 },
  { id: 'doc.context', label: 'Contexto', scope: 'document', weight: 6 },
  { id: 'doc.assumptions', label: 'Supuestos', scope: 'document', weight: 5 },
  { id: 'doc.risks', label: 'Riesgos', scope: 'document', weight: 6 },
  { id: 'doc.decisions', label: 'Decisiones', scope: 'document', weight: 6 },
  { id: 'doc.traceability', label: 'Trazabilidad', scope: 'document', weight: 7 },
  { id: 'doc.acceptance', label: 'Criterios de aceptación', scope: 'document', weight: 7 },
  { id: 'doc.tables', label: 'Completitud de tablas', scope: 'table', weight: 6 },
  { id: 'doc.readability', label: 'Legibilidad', scope: 'document', weight: 7 },
  { id: 'doc.terminology', label: 'Consistencia terminológica', scope: 'document', weight: 6 },
  { id: 'doc.executive', label: 'Preparación ejecutiva', scope: 'document', weight: 7 },
  { id: 'doc.technical', label: 'Preparación técnica', scope: 'document', weight: 7 },
  { id: 'doc.exportability', label: 'Exportabilidad', scope: 'export', weight: 8 },
];

const DOC_EXECUTIVE_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'doc.objective', label: 'Objetivo ejecutivo', scope: 'document', weight: 12 },
  { id: 'doc.context', label: 'Contexto de negocio', scope: 'document', weight: 12 },
  { id: 'doc.decisions', label: 'Decisiones estratégicas', scope: 'document', weight: 12 },
  { id: 'doc.risks', label: 'Riesgos y mitigaciones', scope: 'document', weight: 10 },
  { id: 'doc.headings', label: 'Estructura ejecutiva', scope: 'document', weight: 8 },
  { id: 'doc.readability', label: 'Legibilidad ejecutiva', scope: 'document', weight: 12 },
  { id: 'doc.executive', label: 'Tono ejecutivo', scope: 'document', weight: 12 },
  { id: 'doc.terminology', label: 'Consistencia terminológica', scope: 'document', weight: 6 },
  { id: 'doc.tables', label: 'Tablas resumen', scope: 'table', weight: 6 },
  { id: 'doc.exportability', label: 'Exportabilidad', scope: 'export', weight: 10 },
];

const MATRIX_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'matrix.headers', label: 'Encabezados claros', scope: 'table', weight: 14 },
  { id: 'matrix.completeness', label: 'Filas completas', scope: 'table', weight: 18 },
  { id: 'matrix.coverage', label: 'Cobertura de trazabilidad', scope: 'traceability', weight: 18 },
  { id: 'doc.objective', label: 'Objetivo de la matriz', scope: 'document', weight: 10 },
  { id: 'doc.headings', label: 'Estructura del documento', scope: 'document', weight: 8 },
  { id: 'doc.terminology', label: 'Consistencia terminológica', scope: 'document', weight: 8 },
  { id: 'doc.exportability', label: 'Exportabilidad (CSV/XLSX)', scope: 'export', weight: 14 },
  { id: 'doc.technical', label: 'Preparación técnica', scope: 'document', weight: 10 },
];

const DATA_DICTIONARY_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'matrix.headers', label: 'Encabezados de campos', scope: 'table', weight: 12 },
  { id: 'dict.fields', label: 'Definición de campos', scope: 'table', weight: 16 },
  { id: 'dict.types', label: 'Tipos y formatos declarados', scope: 'table', weight: 14 },
  { id: 'dict.sensitivity', label: 'Sensibilidad/PII/PHI', scope: 'table', weight: 10 },
  { id: 'matrix.completeness', label: 'Filas completas', scope: 'table', weight: 12 },
  { id: 'doc.objective', label: 'Objetivo del diccionario', scope: 'document', weight: 8 },
  { id: 'doc.terminology', label: 'Consistencia terminológica', scope: 'document', weight: 8 },
  { id: 'doc.exportability', label: 'Exportabilidad', scope: 'export', weight: 10 },
  { id: 'doc.technical', label: 'Preparación técnica', scope: 'document', weight: 10 },
];

const DIAGRAM_BASE_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'diag.nodes', label: 'Existencia de nodos', scope: 'diagram', weight: 8 },
  { id: 'diag.edges', label: 'Existencia de aristas', scope: 'diagram', weight: 8 },
  { id: 'diag.orphans', label: 'Sin nodos huérfanos', scope: 'diagram', weight: 8 },
  { id: 'diag.connectivity', label: 'Conectividad', scope: 'diagram', weight: 8 },
  { id: 'diag.labels', label: 'Labels legibles', scope: 'diagram', weight: 8 },
  { id: 'diag.edgeLabels', label: 'Labels de aristas significativos', scope: 'diagram', weight: 8 },
  { id: 'diag.grouping', label: 'Agrupación lógica', scope: 'diagram', weight: 6 },
  { id: 'diag.layout', label: 'Layout adecuado', scope: 'diagram', weight: 6 },
  { id: 'diag.density', label: 'Densidad visual', scope: 'diagram', weight: 6 },
  { id: 'diag.syntax', label: 'Sintaxis válida', scope: 'diagram', weight: 8 },
  { id: 'diag.reactflowCompat', label: 'Compatibilidad ReactFlow', scope: 'diagram', weight: 4 },
  { id: 'diag.exportability', label: 'Exportabilidad PNG/SVG', scope: 'export', weight: 6 },
  { id: 'diag.executive', label: 'Preparación ejecutiva', scope: 'diagram', weight: 6 },
  { id: 'diag.technical', label: 'Preparación técnica', scope: 'diagram', weight: 6 },
  { id: 'diag.maintenance', label: 'Mantenibilidad', scope: 'diagram', weight: 4 },
];

const HYBRID_DIMENSIONS: readonly DimensionSpec[] = [
  { id: 'doc.objective', label: 'Objetivo', scope: 'document', weight: 8 },
  { id: 'doc.headings', label: 'Estructura del documento', scope: 'document', weight: 8 },
  { id: 'doc.readability', label: 'Legibilidad', scope: 'document', weight: 8 },
  { id: 'doc.decisions', label: 'Decisiones', scope: 'document', weight: 6 },
  { id: 'doc.risks', label: 'Riesgos', scope: 'document', weight: 6 },
  { id: 'doc.traceability', label: 'Trazabilidad', scope: 'document', weight: 6 },
  { id: 'doc.tables', label: 'Tablas', scope: 'table', weight: 6 },
  { id: 'diag.nodes', label: 'Nodos del diagrama', scope: 'diagram', weight: 6 },
  { id: 'diag.edges', label: 'Aristas del diagrama', scope: 'diagram', weight: 6 },
  { id: 'diag.labels', label: 'Labels del diagrama', scope: 'diagram', weight: 6 },
  { id: 'diag.syntax', label: 'Sintaxis válida', scope: 'diagram', weight: 6 },
  { id: 'doc.exportability', label: 'Exportabilidad documental', scope: 'export', weight: 8 },
  { id: 'diag.exportability', label: 'Exportabilidad diagramática', scope: 'export', weight: 6 },
  { id: 'doc.executive', label: 'Preparación ejecutiva', scope: 'document', weight: 7 },
  { id: 'doc.technical', label: 'Preparación técnica', scope: 'document', weight: 7 },
];

const DEFAULT_THRESHOLDS = { worldClass: 90, professional: 80, acceptable: 70, exportFloor: 50 } as const;
const STRICT_THRESHOLDS = { worldClass: 92, professional: 82, acceptable: 70, exportFloor: 55 } as const;
const SOFT_THRESHOLDS = { worldClass: 88, professional: 75, acceptable: 60, exportFloor: 45 } as const;

const profiles: ArtifactQualityProfile[] = [
  {
    id: 'profile.document.executive',
    label: 'Presentación ejecutiva',
    family: 'document-executive',
    appliesTo: ['presentation-executive', 'presentation-summary'],
    dimensions: DOC_EXECUTIVE_DIMENSIONS,
    thresholds: STRICT_THRESHOLDS,
  },
  {
    id: 'profile.document.technical',
    label: 'Documento técnico',
    family: 'document-technical',
    appliesTo: ['markdown', 'presentation-technical', 'presentation-overview', 'yaml'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.document.srs',
    label: 'SRS / Requisitos',
    family: 'document-srs',
    appliesTo: ['sdd-use-case', 'sdd-user-story', 'sdd-nfr'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.document.brd',
    label: 'BRD / Negocio',
    family: 'document-brd',
    appliesTo: ['sdd-brd'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.document.sdd',
    label: 'SDD / Diseño',
    family: 'document-sdd',
    appliesTo: ['sdd-domain-model'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.document.glossary',
    label: 'Glosario',
    family: 'document-glossary',
    appliesTo: ['sdd-glossary'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: SOFT_THRESHOLDS,
  },
  {
    id: 'profile.document.bdd',
    label: 'BDD / Escenarios',
    family: 'document-bdd',
    appliesTo: ['sdd-bdd'],
    dimensions: DOC_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.matrix.traceability',
    label: 'Matriz de trazabilidad',
    family: 'matrix',
    appliesTo: ['sdd-traceability'],
    dimensions: MATRIX_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.data-dictionary',
    label: 'Diccionario de datos',
    family: 'data-dictionary',
    // Data dictionaries are typed as `markdown` today; consumers route to this
    // profile manually via `resolveDataDictionaryProfile` when classification
    // detects PII/PHI/field-table signals. We register the dimensions here so
    // they participate in the public listing and can be picked up in the
    // future when a dedicated artifact type lands.
    appliesTo: [],
    dimensions: DATA_DICTIONARY_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.c4',
    label: 'Diagrama C4',
    family: 'diagram-c4',
    appliesTo: ['mermaid-c4-context', 'mermaid-c4-container', 'mermaid-c4-component', 'mermaid-c4-deployment'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: STRICT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.process',
    label: 'Diagrama de proceso',
    family: 'diagram-process',
    appliesTo: ['mermaid-graph', 'mermaid-state', 'mermaid-gantt'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.data-flow',
    label: 'Diagrama de flujo de datos',
    family: 'diagram-data-flow',
    appliesTo: ['react-flow-graph'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.sequence',
    label: 'Diagrama de secuencia',
    family: 'diagram-sequence',
    appliesTo: ['mermaid-sequence'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.erd',
    label: 'Diagrama ERD',
    family: 'diagram-erd',
    appliesTo: ['mermaid-erd'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
  {
    id: 'profile.diagram.event-storming',
    label: 'Event Storming',
    family: 'diagram-process',
    appliesTo: ['sdd-event-storming'],
    dimensions: DIAGRAM_BASE_DIMENSIONS,
    thresholds: SOFT_THRESHOLDS,
  },
  {
    id: 'profile.hybrid',
    label: 'Documento + Diagrama',
    family: 'hybrid',
    appliesTo: ['hybrid-text-diagram'],
    dimensions: HYBRID_DIMENSIONS,
    thresholds: DEFAULT_THRESHOLDS,
  },
];

const PROFILE_INDEX = new Map<ArtifactType, ArtifactQualityProfile>();
for (const profile of profiles) {
  for (const type of profile.appliesTo) PROFILE_INDEX.set(type, profile);
}

const FALLBACK_DOC_PROFILE: ArtifactQualityProfile = {
  id: 'profile.document.fallback',
  label: 'Documento (genérico)',
  family: 'document-technical',
  appliesTo: [],
  dimensions: DOC_BASE_DIMENSIONS,
  thresholds: SOFT_THRESHOLDS,
};

const FALLBACK_DIAGRAM_PROFILE: ArtifactQualityProfile = {
  id: 'profile.diagram.fallback',
  label: 'Diagrama (genérico)',
  family: 'diagram-process',
  appliesTo: [],
  dimensions: DIAGRAM_BASE_DIMENSIONS,
  thresholds: SOFT_THRESHOLDS,
};

/**
 * Resolve the profile for an artifact. Diagram-typed artifacts default to the
 * diagram fallback; everything else falls back to the document profile. This
 * guarantees deterministic scoring even for newly-added artifact types.
 */
export const resolveQualityProfile = (artifactType: ArtifactType): ArtifactQualityProfile => {
  const direct = PROFILE_INDEX.get(artifactType);
  if (direct) return direct;
  if (artifactType.startsWith('mermaid') || artifactType === 'react-flow-graph') {
    return FALLBACK_DIAGRAM_PROFILE;
  }
  return FALLBACK_DOC_PROFILE;
};

export const dataDictionaryProfile = (): ArtifactQualityProfile =>
  profiles.find((p) => p.family === 'data-dictionary') ?? FALLBACK_DOC_PROFILE;

export const listQualityProfiles = (): readonly ArtifactQualityProfile[] => profiles;

export const QUALITY_PROFILE_FALLBACKS = {
  document: FALLBACK_DOC_PROFILE,
  diagram: FALLBACK_DIAGRAM_PROFILE,
} as const;
