/**
 * Publication profile + editorial template registry.
 *
 * Profiles describe the contract for a class of deliverable (audience, purpose,
 * required sections, artifact coverage, quality bar, export formats, governance
 * flags). Templates describe the ordered editorial blocks used to render a
 * deliverable. Both are pure data, fully decoupled from the UI.
 *
 * The registry is the single source of truth — the readiness, preflight, report
 * and export services all resolve profiles/templates through it.
 */

import type { ArtifactType } from '../../types';
import type {
  PublicationArtifactRequirement,
  PublicationAudience,
  PublicationProfile,
  PublicationProfileSection,
  PublicationTemplate,
  PublicationTemplateBlock,
  PublicationTemplateQuery,
} from './PublicationPipelineTypes';

/* ------------------------------------------------------------------------- */
/* Section + block authoring helpers                                          */
/* ------------------------------------------------------------------------- */

const section = (
  id: string,
  title: string,
  description: string,
  required = true,
): PublicationProfileSection => ({ id, title, description, required });

const requirement = (
  id: string,
  label: string,
  anyOf: ArtifactType[],
  required = true,
  min = 1,
): PublicationArtifactRequirement => ({ id, label, anyOf, min, required });

const block = (
  id: string,
  kind: PublicationTemplateBlock['kind'],
  title: string,
  required = true,
  guidance?: string,
): PublicationTemplateBlock => ({ id, kind, title, required, guidance });

/**
 * Derive the flat `requiredArtifactTypes` / `optionalArtifactTypes` lists from
 * the rich `artifactRequirements`. A requirement contributes to the flat
 * required list only when it is required AND unambiguous (a single allowed
 * type); everything else is surfaced as optional. This keeps the canonical
 * contract fields populated without over-constraining "any-of" slots.
 */
const deriveFlatTypes = (
  requirements: PublicationArtifactRequirement[],
): { required: ArtifactType[]; optional: ArtifactType[] } => {
  const required: ArtifactType[] = [];
  const optional: ArtifactType[] = [];
  for (const req of requirements) {
    if (req.required && req.anyOf.length === 1) {
      required.push(req.anyOf[0]);
    } else {
      for (const type of req.anyOf) {
        if (!required.includes(type)) optional.push(type);
      }
    }
  }
  return {
    required: Array.from(new Set(required)),
    optional: Array.from(new Set(optional.filter((t) => !required.includes(t)))),
  };
};

/* ------------------------------------------------------------------------- */
/* Editorial templates                                                        */
/* ------------------------------------------------------------------------- */

/** The standard governance blocks shared by every professional deliverable. */
const governanceBlocks: PublicationTemplateBlock[] = [
  block('cover', 'cover', 'Portada', true),
  block('toc', 'table-of-contents', 'Tabla de contenido', true),
  block('version-control', 'version-control', 'Control de versiones', true),
  block('approval-control', 'approval-control', 'Control de aprobación', true),
];

const closingBlocks: PublicationTemplateBlock[] = [
  block('glossary', 'glossary', 'Glosario', false),
  block('traceability', 'traceability-matrix', 'Matriz de trazabilidad', false),
  block('appendices', 'appendix', 'Apéndices', false),
  block('publication-notes', 'publication-notes', 'Notas de publicación', true),
  block('metadata', 'metadata', 'Metadatos', true),
  block('branding', 'branding', 'Marca', true),
  block('footer', 'footer', 'Pie de página', true),
];

const templates: Record<string, PublicationTemplate> = {
  'template-executive': {
    id: 'template-executive',
    name: 'Plantilla ejecutiva',
    description: 'Estructura editorial breve y orientada a decisión para comité ejecutivo.',
    audience: 'executive',
    detailLevel: 'summary',
    blocks: [
      ...governanceBlocks,
      block('summary', 'executive-summary', 'Resumen ejecutivo', true),
      block('objective', 'section', 'Objetivo', true),
      block('context', 'section', 'Contexto', true),
      block('decisions', 'section', 'Decisiones clave', true),
      block('risks', 'section', 'Riesgos principales', true),
      block('kpis', 'section', 'KPIs e impactos', true),
      block('recommendations', 'section', 'Recomendaciones', true),
      ...closingBlocks,
    ],
  },
  'template-technical': {
    id: 'template-technical',
    name: 'Plantilla técnica',
    description: 'Estructura editorial detallada para revisión de arquitectura técnica.',
    audience: 'technical',
    detailLevel: 'detailed',
    blocks: [
      ...governanceBlocks,
      block('summary', 'executive-summary', 'Resumen', true),
      block('context', 'section', 'Contexto', true),
      block('architecture', 'section', 'Arquitectura (C4 / componentes)', true),
      block('integrations', 'section', 'Integraciones', true),
      block('data', 'section', 'Datos', true),
      block('nfr', 'section', 'Requerimientos no funcionales', true),
      block('risks', 'section', 'Riesgos', true),
      block('decisions', 'section', 'Decisiones', true),
      ...closingBlocks,
    ],
  },
  'template-sdd': {
    id: 'template-sdd',
    name: 'Plantilla SDD',
    description: 'Estructura editorial para un Documento de Diseño de Solución completo.',
    audience: 'technical',
    detailLevel: 'detailed',
    blocks: [
      ...governanceBlocks,
      block('summary', 'executive-summary', 'Resumen', true),
      block('brd', 'section', 'Requerimientos de negocio (BRD)', true),
      block('use-cases', 'section', 'Casos de uso e historias', true),
      block('nfr', 'section', 'Requerimientos no funcionales', true),
      block('bdd', 'section', 'Escenarios BDD', false),
      block('assumptions', 'section', 'Supuestos y criterios de aceptación', true),
      ...closingBlocks,
    ],
  },
  'template-vendor': {
    id: 'template-vendor',
    name: 'Plantilla de evaluación de proveedor',
    description: 'Estructura editorial para evaluación y selección de proveedores.',
    audience: 'vendor',
    detailLevel: 'standard',
    blocks: [
      ...governanceBlocks,
      block('summary', 'executive-summary', 'Resumen', true),
      block('objective', 'section', 'Objetivo y alcance', true),
      block('requirements', 'section', 'Requerimientos', true),
      block('gaps', 'section', 'Brechas y riesgos', true),
      block('comparison', 'section', 'Matriz comparativa', true),
      block('criteria', 'section', 'Criterios de evaluación', true),
      block('questions', 'section', 'Preguntas y decisiones pendientes', true),
      ...closingBlocks,
    ],
  },
  'template-audit': {
    id: 'template-audit',
    name: 'Plantilla de evidencia de auditoría',
    description: 'Estructura editorial para empaquetar evidencia auditable.',
    audience: 'audit',
    detailLevel: 'detailed',
    blocks: [
      ...governanceBlocks,
      block('manifest', 'metadata', 'Manifiesto', true),
      block('versions', 'version-control', 'Versiones', true),
      block('traceability-ev', 'traceability-matrix', 'Trazabilidad', true),
      block('approval-ev', 'approval-control', 'Evidencia de aprobación', true),
      block('quality-ev', 'section', 'Evidencia de calidad', true),
      block('risks', 'section', 'Riesgos, mitigaciones y controles', true),
      block('history', 'section', 'Historial de cambios', true),
      ...closingBlocks,
    ],
  },
  'template-implementation': {
    id: 'template-implementation',
    name: 'Plantilla de entrega a implementación',
    description: 'Estructura editorial para el handoff al equipo de implementación.',
    audience: 'implementation-team',
    detailLevel: 'detailed',
    blocks: [
      ...governanceBlocks,
      block('summary', 'executive-summary', 'Resumen', true),
      block('target-arch', 'section', 'Arquitectura objetivo', true),
      block('integrations', 'section', 'Integraciones y APIs', true),
      block('data', 'section', 'Modelo de datos', true),
      block('sequences', 'section', 'Secuencias', false),
      block('nfr', 'section', 'NFRs', true),
      block('tests', 'section', 'Casos de prueba', true),
      block('pending', 'section', 'Riesgos, decisiones y pendientes', true),
      ...closingBlocks,
    ],
  },
};

/* ------------------------------------------------------------------------- */
/* Profiles                                                                    */
/* ------------------------------------------------------------------------- */

const buildProfile = (
  base: Omit<PublicationProfile, 'requiredArtifactTypes' | 'optionalArtifactTypes'>,
): PublicationProfile => {
  const flat = deriveFlatTypes(base.artifactRequirements);
  return { ...base, requiredArtifactTypes: flat.required, optionalArtifactTypes: flat.optional };
};

const profiles: Record<string, PublicationProfile> = {
  'executive-architecture-brief': buildProfile({
    id: 'executive-architecture-brief',
    name: 'Executive Architecture Brief',
    description: 'Resumen ejecutivo de arquitectura para decisión de comité.',
    audience: 'executive',
    purpose: 'executive-briefing',
    requiredSections: [
      section('executive-summary', 'Resumen ejecutivo', 'Síntesis de una página de la solución y su valor.'),
      section('objective', 'Objetivo', 'Qué problema de negocio resuelve la arquitectura.'),
      section('context', 'Contexto', 'Situación actual y motivación del cambio.'),
      section('key-decisions', 'Decisiones clave', 'Decisiones arquitectónicas con su justificación.'),
      section('main-risks', 'Riesgos principales', 'Riesgos relevantes y su mitigación.'),
      section('context-diagram', 'Diagrama de contexto o contenedor', 'Vista visual de alto nivel.'),
      section('kpis', 'KPIs o impactos', 'Indicadores e impactos esperados.'),
      section('recommendations', 'Recomendaciones', 'Próximos pasos recomendados.'),
    ],
    artifactRequirements: [
      requirement('context-or-container', 'Diagrama de contexto o contenedor',
        ['mermaid-c4-context', 'mermaid-c4-container', 'react-flow-graph']),
      requirement('executive-narrative', 'Documento o presentación ejecutiva',
        ['markdown', 'hybrid-text-diagram', 'presentation-executive'], false),
    ],
    qualityThreshold: 75,
    accessibilityLevel: 'standard',
    exportFormats: ['pdf', 'docx', 'html', 'md'],
    approvalRequired: true,
    brandingRequired: true,
    traceabilityRequired: false,
    appendicesRequired: false,
  }),
  'technical-architecture-package': buildProfile({
    id: 'technical-architecture-package',
    name: 'Technical Architecture Package',
    description: 'Paquete técnico completo para revisión de arquitectura.',
    audience: 'technical',
    purpose: 'architecture-review',
    requiredSections: [
      section('context', 'Contexto', 'Contexto técnico y de negocio.'),
      section('c4-context', 'C4 Context', 'Diagrama de contexto del sistema.'),
      section('c4-container', 'C4 Container', 'Diagrama de contenedores.'),
      section('components', 'Componentes', 'Descomposición en componentes.'),
      section('integrations', 'Integraciones', 'Integraciones y protocolos.'),
      section('data', 'Datos', 'Modelo y flujos de datos.'),
      section('nfr', 'NFRs', 'Requerimientos no funcionales con métricas.'),
      section('risks', 'Riesgos', 'Riesgos técnicos y mitigaciones.'),
      section('decisions', 'Decisiones', 'Decisiones arquitectónicas.'),
      section('traceability', 'Trazabilidad', 'Trazabilidad entre artefactos.'),
      section('appendices', 'Apéndices técnicos', 'Material técnico complementario.', false),
    ],
    artifactRequirements: [
      requirement('c4-context', 'C4 Context', ['mermaid-c4-context']),
      requirement('c4-container', 'C4 Container', ['mermaid-c4-container']),
      requirement('components', 'Componentes',
        ['mermaid-c4-component', 'react-flow-graph'], false),
      requirement('data-model', 'Modelo de datos', ['mermaid-erd'], false),
      requirement('nfr-spec', 'Especificación de NFR', ['sdd-nfr'], false),
    ],
    qualityThreshold: 80,
    accessibilityLevel: 'standard',
    exportFormats: ['pdf', 'docx', 'html', 'md', 'json'],
    approvalRequired: true,
    brandingRequired: true,
    traceabilityRequired: true,
    appendicesRequired: false,
  }),
  'solution-design-document-package': buildProfile({
    id: 'solution-design-document-package',
    name: 'Solution Design Document Package',
    description: 'Documento de Diseño de Solución (SDD) completo y trazable.',
    audience: 'technical',
    purpose: 'technical-design',
    requiredSections: [
      section('brd', 'BRD', 'Documento de requerimientos de negocio.'),
      section('use-cases', 'Casos de uso', 'Especificaciones de casos de uso.'),
      section('user-stories', 'Historias de usuario', 'Backlog e historias.'),
      section('nfr', 'NFR', 'Requerimientos no funcionales.'),
      section('bdd', 'BDD', 'Escenarios BDD en Gherkin.', false),
      section('traceability-matrix', 'Matriz de trazabilidad', 'Trazabilidad de requerimientos.'),
      section('glossary', 'Glosario', 'Lenguaje ubicuo del dominio.'),
      section('risks', 'Riesgos', 'Riesgos y supuestos.'),
      section('acceptance', 'Criterios de aceptación', 'Criterios de aceptación verificables.'),
    ],
    artifactRequirements: [
      requirement('brd', 'BRD', ['sdd-brd']),
      requirement('use-cases', 'Casos de uso o historias',
        ['sdd-use-case', 'sdd-user-story']),
      requirement('nfr', 'NFR', ['sdd-nfr']),
      requirement('traceability', 'Matriz de trazabilidad', ['sdd-traceability']),
      requirement('glossary', 'Glosario', ['sdd-glossary'], false),
      requirement('bdd', 'Escenarios BDD', ['sdd-bdd'], false),
    ],
    qualityThreshold: 78,
    accessibilityLevel: 'standard',
    exportFormats: ['pdf', 'docx', 'html', 'md', 'xlsx'],
    approvalRequired: true,
    brandingRequired: true,
    traceabilityRequired: true,
    appendicesRequired: false,
  }),
  'vendor-evaluation-package': buildProfile({
    id: 'vendor-evaluation-package',
    name: 'Vendor Evaluation Package',
    description: 'Paquete para evaluación y selección de proveedores.',
    audience: 'vendor',
    purpose: 'vendor-evaluation',
    requiredSections: [
      section('objective', 'Objetivo', 'Objetivo de la evaluación.'),
      section('scope', 'Alcance', 'Alcance del proceso de selección.'),
      section('requirements', 'Requerimientos', 'Requerimientos a satisfacer.'),
      section('gaps', 'Brechas', 'Brechas frente al estado deseado.'),
      section('risks', 'Riesgos', 'Riesgos de la decisión.'),
      section('comparison-matrix', 'Matriz comparativa', 'Comparación estructurada de opciones.'),
      section('criteria', 'Criterios de evaluación', 'Criterios y pesos de evaluación.'),
      section('pending-decisions', 'Decisiones pendientes', 'Decisiones por resolver.'),
      section('vendor-questions', 'Preguntas para proveedor', 'Preguntas formales al proveedor.'),
    ],
    artifactRequirements: [
      requirement('requirements', 'Requerimientos o BRD',
        ['sdd-brd', 'markdown', 'hybrid-text-diagram']),
      requirement('comparison', 'Matriz comparativa',
        ['markdown', 'hybrid-text-diagram', 'sdd-traceability'], false),
    ],
    qualityThreshold: 72,
    accessibilityLevel: 'basic',
    exportFormats: ['pdf', 'docx', 'html', 'xlsx'],
    approvalRequired: true,
    brandingRequired: true,
    traceabilityRequired: false,
    appendicesRequired: false,
  }),
  'audit-evidence-package': buildProfile({
    id: 'audit-evidence-package',
    name: 'Audit Evidence Package',
    description: 'Paquete de evidencia auditable, versionada y trazable.',
    audience: 'audit',
    purpose: 'audit-evidence',
    requiredSections: [
      section('manifest', 'Manifest', 'Manifiesto de los artefactos incluidos.'),
      section('versions', 'Versiones', 'Versiones de cada artefacto.'),
      section('traceability', 'Trazabilidad', 'Evidencia de trazabilidad.'),
      section('approval-evidence', 'Evidencia de aprobación', 'Registro de aprobaciones.'),
      section('exported-artifacts', 'Artefactos exportados', 'Lista de archivos exportados.'),
      section('change-history', 'Historial de cambios', 'Auditoría de cambios.'),
      section('risks', 'Riesgos y mitigaciones', 'Riesgos y sus mitigaciones.'),
      section('security-controls', 'Controles de seguridad', 'Controles de seguridad aplicados.'),
      section('quality-evidence', 'Evidencia de calidad', 'Resultados de calidad.'),
    ],
    artifactRequirements: [
      requirement('any-evidence', 'Al menos un artefacto trazable',
        ['markdown', 'hybrid-text-diagram', 'sdd-traceability', 'sdd-brd',
          'mermaid-c4-context', 'mermaid-c4-container']),
    ],
    qualityThreshold: 85,
    accessibilityLevel: 'strict',
    exportFormats: ['pdf', 'docx', 'html', 'md', 'json', 'xlsx'],
    approvalRequired: true,
    brandingRequired: true,
    traceabilityRequired: true,
    appendicesRequired: true,
  }),
  'implementation-handoff-package': buildProfile({
    id: 'implementation-handoff-package',
    name: 'Implementation Handoff Package',
    description: 'Paquete de entrega para el equipo de implementación.',
    audience: 'implementation-team',
    purpose: 'implementation-handoff',
    requiredSections: [
      section('target-architecture', 'Arquitectura objetivo', 'Arquitectura a implementar.'),
      section('integrations', 'Integraciones', 'Integraciones requeridas.'),
      section('apis', 'APIs', 'Contratos de API.'),
      section('data-model', 'Modelo de datos', 'Modelo de datos objetivo.'),
      section('sequences', 'Secuencias', 'Diagramas de secuencia.', false),
      section('nfr', 'NFRs', 'Requerimientos no funcionales.'),
      section('risks', 'Riesgos', 'Riesgos de implementación.'),
      section('decisions', 'Decisiones', 'Decisiones que condicionan la entrega.'),
      section('test-cases', 'Casos de prueba', 'Casos de prueba a cubrir.'),
      section('pending', 'Pendientes', 'Pendientes y dependencias.'),
    ],
    artifactRequirements: [
      requirement('target-arch', 'Arquitectura objetivo',
        ['mermaid-c4-container', 'mermaid-c4-component', 'react-flow-graph']),
      requirement('data-model', 'Modelo de datos', ['mermaid-erd'], false),
      requirement('sequences', 'Secuencias', ['mermaid-sequence'], false),
      requirement('tests', 'Casos de prueba', ['sdd-bdd', 'sdd-use-case'], false),
    ],
    qualityThreshold: 80,
    accessibilityLevel: 'standard',
    exportFormats: ['pdf', 'docx', 'html', 'md', 'json'],
    approvalRequired: false,
    brandingRequired: true,
    traceabilityRequired: true,
    appendicesRequired: false,
  }),
};

/** Maps a profile id to the editorial template it renders with. */
const PROFILE_TEMPLATE: Record<string, string> = {
  'executive-architecture-brief': 'template-executive',
  'technical-architecture-package': 'template-technical',
  'solution-design-document-package': 'template-sdd',
  'vendor-evaluation-package': 'template-vendor',
  'audit-evidence-package': 'template-audit',
  'implementation-handoff-package': 'template-implementation',
};

/* ------------------------------------------------------------------------- */
/* Public registry surface                                                    */
/* ------------------------------------------------------------------------- */

/** List every registered publication profile. */
export const listPublicationProfiles = (): PublicationProfile[] => Object.values(profiles);

/** Resolve a profile by id. Returns `undefined` for unknown ids — never throws. */
export const getPublicationProfile = (id: string): PublicationProfile | undefined => profiles[id];

/**
 * Resolve a profile by id, falling back to the executive brief profile when the
 * id is unknown. Use this on hot paths that must always have a profile.
 */
export const resolvePublicationProfile = (id: string | undefined): PublicationProfile =>
  (id ? profiles[id] : undefined) ?? profiles['executive-architecture-brief'];

/** Find the first profile that targets a given audience. */
export const getProfileByAudience = (audience: PublicationAudience): PublicationProfile | undefined =>
  Object.values(profiles).find((profile) => profile.audience === audience);

/** List every editorial template. */
export const listPublicationTemplates = (): PublicationTemplate[] => Object.values(templates);

/** Resolve a template by id. Returns `undefined` for unknown ids. */
export const getPublicationTemplate = (id: string): PublicationTemplate | undefined => templates[id];

/**
 * Resolve the editorial template for a query. Resolution order:
 *  1. explicit `profileId`
 *  2. explicit `audience`
 *  3. fallback to the executive template.
 * The `detailLevel` / `exportFormat` hints are accepted for future template
 * variants and never cause a miss.
 */
export const resolvePublicationTemplate = (query: PublicationTemplateQuery): PublicationTemplate => {
  if (query.profileId) {
    const byProfile = templates[PROFILE_TEMPLATE[query.profileId] ?? ''];
    if (byProfile) return byProfile;
  }
  if (query.audience) {
    const byAudience = Object.values(templates).find((t) => t.audience === query.audience);
    if (byAudience) return byAudience;
  }
  return templates['template-executive'];
};
