import type { ArtifactType } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import type { ArtifactCompilerSummary } from '../../services/artifactCompiler/ArtifactCompilerTypes';
import { computeArtifactCompilationSignature } from '../../services/artifactCompiler';

/** Build a compiler summary for a fixture artifact. */
export const makeCompilation = (
  overrides: Partial<ArtifactCompilerSummary> = {},
): ArtifactCompilerSummary => ({
  compilerContractId: 'contract-markdown',
  compilerContractLabel: 'Documento Markdown',
  compilerStatus: 'passed',
  compilerScore: 92,
  compilerTier: 'world-class',
  compilerIssues: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  compilerRepairs: [],
  compilerRecommendations: [],
  compiledAt: '2026-05-17T00:00:00.000Z',
  requiresHumanReview: false,
  exportReadiness: { document: true, diagram: false, table: false, any: true },
  ...overrides,
});

/** Build a fixture artifact with sensible defaults. */
export const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => {
  const id = overrides.id ?? 'art-pub-1';
  const artifact: Artifact = {
    id,
    versionGroupId: overrides.versionGroupId ?? id,
    version: 1,
    createdAt: '2026-05-17T00:00:00.000Z',
    name: 'Artefacto de prueba',
    type: 'markdown' as ArtifactType,
    phase: 'Lógica',
    architecturalView: 'Vista Lógica y de Diseño',
    content: '# Documento\n\n## Objetivo\nContenido suficiente para el preflight de publicación.',
    objective: 'Objetivo del artefacto de prueba para publicación.',
    keyConcepts: [],
    representation: 'document',
    reviewStatus: 'approved',
    compilation: makeCompilation(),
    ...overrides,
  };
  // Stamp a current signature so the publication bridge treats the persisted
  // snapshot as fresh — mirrors how AppContext recompiles before persisting.
  if (artifact.compilation) {
    artifact.compilation = {
      ...artifact.compilation,
      compilationFreshness: 'current',
      sourceSignature: computeArtifactCompilationSignature(artifact),
    };
  }
  return artifact;
};

/** A world-class document artifact (rich content, high compiler score). */
export const worldClassDocument = (): Artifact => makeArtifact({
  id: 'art-wc-doc',
  name: 'Documento de diseño de clase mundial',
  content: [
    '# Documento de Diseño',
    '',
    '## Objetivo',
    'Definir la arquitectura del módulo de órdenes para sostener diez veces el tráfico actual.',
    '',
    '## Contexto',
    'El sistema monolítico actual no escala y concentra el riesgo operativo.',
    '',
    '## Alcance',
    '- Incluye: módulo de órdenes y pagos.',
    '- Excluye: integraciones legadas.',
    '',
    '## Riesgos',
    '| Riesgo | Severidad | Mitigación |',
    '|---|---|---|',
    '| Migración de datos | Alta | Backfill incremental verificado |',
    '',
    '## Decisiones',
    'Se adopta una arquitectura de microservicios desacoplados.',
  ].join('\n'),
  compilation: makeCompilation({ compilerScore: 95, compilerTier: 'world-class' }),
});

/** An empty artifact — must be blocked by preflight. */
export const emptyDocument = (): Artifact => makeArtifact({
  id: 'art-empty',
  name: 'Artefacto vacío',
  content: '',
  reviewStatus: 'draft',
  compilation: makeCompilation({
    compilerStatus: 'blocked',
    compilerScore: 0,
    compilerTier: 'blocked',
    compilerIssues: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
  }),
});

/** A corrupt artifact — content is not a string. */
export const corruptDocument = (): Artifact => makeArtifact({
  id: 'art-corrupt',
  name: 'Artefacto corrupto',
  content: undefined as unknown as string,
});

/** A document whose compilation failed. */
export const compilationFailedDocument = (): Artifact => makeArtifact({
  id: 'art-failed',
  name: 'Artefacto con compilación fallida',
  compilation: makeCompilation({
    compilerStatus: 'failed',
    compilerScore: 30,
    compilerTier: 'blocked',
    compilerIssues: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
    requiresHumanReview: true,
  }),
});

/** A mid-quality document that should warn but not block. */
export const mediumScoreDocument = (): Artifact => makeArtifact({
  id: 'art-medium',
  name: 'Documento de calidad media',
  compilation: makeCompilation({
    compilerStatus: 'warning',
    compilerScore: 64,
    compilerTier: 'needs-improvement',
    compilerIssues: { critical: 0, high: 1, medium: 2, low: 0, info: 0 },
  }),
});

/** A C4 context diagram artifact. */
export const c4ContextDiagram = (): Artifact => makeArtifact({
  id: 'art-c4-context',
  versionGroupId: 'vg-c4-context',
  name: 'Diagrama de contexto C4',
  type: 'mermaid-c4-context',
  representation: 'diagram',
  content: 'C4Context\n  Person(user, "Usuario")\n  System(sys, "Sistema")\n  Rel(user, sys, "usa")',
  objective: 'Mostrar el contexto del sistema y sus actores externos para la audiencia ejecutiva.',
  ir: {
    nodes: [
      { id: 'user', label: 'Usuario', kind: 'Person' },
      { id: 'sys', label: 'Sistema', kind: 'System' },
    ],
    edges: [{ id: 'e1', source: 'user', target: 'sys', label: 'usa' }],
    groups: [],
    metadata: { sourceFormat: 'mermaid', title: 'Contexto' },
  },
  compilation: makeCompilation({ compilerContractId: 'contract-c4', compilerScore: 88, compilerTier: 'ready' }),
});

/** A C4 container diagram artifact. */
export const c4ContainerDiagram = (): Artifact => makeArtifact({
  id: 'art-c4-container',
  versionGroupId: 'vg-c4-container',
  name: 'Diagrama de contenedores C4',
  type: 'mermaid-c4-container',
  representation: 'diagram',
  content: 'C4Container\n  Container(api, "API")\n  Container(db, "DB")\n  Rel(api, db, "consulta")',
  objective: 'Mostrar los contenedores del sistema y sus relaciones para el equipo técnico.',
  ir: {
    nodes: [
      { id: 'api', label: 'API', kind: 'Container' },
      { id: 'db', label: 'DB', kind: 'Container' },
    ],
    edges: [{ id: 'e1', source: 'api', target: 'db', label: 'consulta' }],
    groups: [],
    metadata: { sourceFormat: 'mermaid', title: 'Contenedores' },
  },
  compilation: makeCompilation({ compilerContractId: 'contract-c4', compilerScore: 85, compilerTier: 'ready' }),
});

/** A diagram artifact that fell back to the skeleton. */
export const skeletonDiagram = (): Artifact => makeArtifact({
  id: 'art-skeleton',
  versionGroupId: 'vg-skeleton',
  name: 'Diagrama esqueleto',
  type: 'mermaid-c4-container',
  representation: 'diagram',
  content: 'C4Container\n  Container(a, "A")',
  objective: 'Diagrama base de respaldo generado tras agotar reintentos de la IA.',
  ir: {
    nodes: [{ id: 'a', label: 'A', kind: 'Container' }],
    edges: [],
    groups: [],
    metadata: { sourceFormat: 'mermaid', fallback: 'skeleton' },
  },
});

/** A project that bundles a set of artifacts. */
export const makeProject = (artifacts: Artifact[], overrides: Partial<Project> = {}): Project => ({
  id: 'proj-pub-1',
  name: 'Proyecto de publicación',
  description: 'Proyecto de prueba para el pipeline de publicación.',
  projectContext: [],
  artifacts,
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
  ...overrides,
});
