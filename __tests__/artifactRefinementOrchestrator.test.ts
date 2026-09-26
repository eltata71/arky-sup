import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactTemplate, Settings } from '../types';
import type { ArtifactGenerationStage } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import { normalizeArtifactEnvelope } from '../services/artifacts/application/artifactGenerationPipeline';
import {
  refineArtifactBeforePersistence,
  isRefinedCandidateSafe,
} from '../services/artifacts/application/artifactRefinementOrchestrator';
import { SKELETON_FALLBACK_MARKER } from '../services/artifacts/domain/artifactFallbackDetection';
import { extractIRFromArtifact } from '../services/diagram';
import { irToReactFlow } from '../services/diagram/irToReactFlow';
import { buildArtifactQualityReport } from '../services/quality/artifactQualityService';
import { buildArtifactExportabilityState } from '../services/quality/artifactQualityGateService';
import { artifactGenerationService } from '../services/ai/generation/artifactGenerationService';

const settings: Settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.2, tone: 'profesional', languageStyle: 'es', apiKeySource: 'global' },
};

const project: Project = {
  id: 'p1',
  name: 'Portal Vida Salud',
  description: 'Modernización del portal digital de seguros de vida y salud.',
  projectContext: ['Canales digitales para asegurados, corredores y operaciones.', 'Integración con core de pólizas y siniestros.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const docTemplate: ArtifactTemplate = {
  name: 'Documento Ejecutivo',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista de Contexto y Negocio',
  objective: 'Explicar propósito, alcance, riesgos y próximos pasos del portal.',
  keyConcepts: [],
  representation: 'document',
  requestContext: { userRequest: 'Crear resumen ejecutivo', audience: 'executive' },
};

const diagramTemplate: ArtifactTemplate = {
  name: 'Diagrama de Contexto',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Mostrar sistemas y relaciones principales.',
  keyConcepts: [],
  representation: 'diagram',
  requestContext: { userRequest: 'Crear diagrama técnico', audience: 'technical' },
};

const hybridTemplate: ArtifactTemplate = {
  ...diagramTemplate,
  name: 'Narrativa con diagrama',
  type: 'hybrid-text-diagram',
  representation: 'hybrid',
};

const tableTemplate: ArtifactTemplate = {
  name: 'Matriz de Trazabilidad',
  type: 'sdd-traceability',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Trazar requisitos contra casos de prueba.',
  keyConcepts: [],
  representation: 'document',
};

const envelopeFor = (template: ArtifactTemplate, content: string) => normalizeArtifactEnvelope({
  artifactId: `env-${template.type}`,
  title: template.name,
  artifactType: template.type,
  representation: template.representation,
  rawResponse: content,
  intent: 'on-demand',
  audience: 'technical',
});

const baseRequest = (template: ArtifactTemplate, draftContent: string, mode?: 'document' | 'diagram' | 'hybrid' | 'table') => ({
  project,
  template,
  settings,
  draftContent,
  envelope: envelopeFor(template, draftContent),
  operationId: 'test-op',
  mode: mode ?? (template.representation === 'hybrid' ? 'hybrid' as const : template.representation === 'diagram' ? 'diagram' as const : 'document' as const),
});

const validMermaid = `graph LR
  Usuario[Usuario asegurado] --> Portal[Portal digital]
  Portal --> API[API de integración]
  API --> Core[Core de pólizas]
`;

const hybrid = `# Vista integrada

Propósito narrativo del flujo.

\`\`\`mermaid
${validMermaid}\`\`\`
`;

const wellStructuredDoc = `# Documento Ejecutivo

## Propósito
Resume el valor de negocio del Portal Vida Salud.

## Alcance
Incluye canales digitales, API de integración y core de pólizas.

## Supuestos
La información será validada con negocio y tecnología.

## Riesgos y consideraciones
Gestionar seguridad, datos personales, disponibilidad e interoperabilidad.

## Próximos pasos
Validar brechas, priorizar decisiones y acordar plan de ejecución.`;

const tableDraft = `# Matriz de Trazabilidad

| ID | Requisito | Caso de prueba |
| --- | --- | --- |
| BR-01 | Autenticación de asegurados | TC-01 |
| BR-02 | Procesamiento de pagos | TC-02 |
`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('artifactRefinementOrchestrator — feature flags', () => {
  it('preserves previous behavior when the feature flag is disabled', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_ENABLED', 'false');
    const draft = 'Documento mínimo sin estructura.';
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, draft));

    expect(result.accepted).toBe(false);
    expect(result.content).toBe(draft);
    expect(result.acceptanceReason).toMatch(/deshabilitado/i);
  });

  it('does not invoke Gemini when AI refinement is disabled', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const critiqueSpy = vi.spyOn(artifactGenerationService, 'critiqueArtifactContent');
    const refineSpy = vi.spyOn(artifactGenerationService, 'refineArtifactContent');
    await refineArtifactBeforePersistence({ ...baseRequest(docTemplate, 'Texto breve.'), targetScore: 100 });

    expect(critiqueSpy).not.toHaveBeenCalled();
    expect(refineSpy).not.toHaveBeenCalled();
  });
});

describe('artifactRefinementOrchestrator — documents', () => {
  it('adds minimum structure to a monolithic document without losing content', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const monolithic = 'El portal digital de seguros de vida y salud moderniza los canales de atención para asegurados, corredores y operaciones, integrando el core de pólizas, el motor de siniestros y los servicios de pago en un flujo unificado, gobernado y trazable que reduce la fricción operativa del negocio.';
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, monolithic));

    expect(result.content).toContain('core de pólizas');
    if (result.accepted) {
      expect(result.content).toContain('## Alcance');
      expect(result.content).toContain('## Riesgos y consideraciones');
    }
  });

  it('adds a title to a document that lacks one', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, '## Resumen\n\nResumen breve del portal de seguros.'));

    expect(result.accepted).toBe(true);
    expect(result.content).toContain('# Documento Ejecutivo');
  });

  it('replaces generic placeholders with project context', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const draft = '## Contexto\n\nEl sistema reemplaza a Empresa X y migra el Sistema legacy hacia la nube de forma incremental.';
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, draft));

    if (result.accepted) {
      expect(result.content).not.toMatch(/\bEmpresa X\b/);
      expect(result.content).toContain('Portal Vida Salud');
    }
  });

  it('does not modify a document that already has professional structure', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, wellStructuredDoc));

    expect(result.accepted).toBe(false);
    expect(result.content).toBe(wellStructuredDoc);
    expect(result.passes.every((pass) => !pass.changed)).toBe(true);
  });

  it('preserves Markdown tables present in a document', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const docWithTable = `## Cobertura\n\n| Plan | Cobertura |\n| --- | --- |\n| Básico | 60% |\n| Pleno | 100% |\n`;
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, docWithTable));

    expect(result.content).toContain('| --- | --- |');
    expect(result.content).toContain('| Pleno | 100% |');
  });
});

describe('artifactRefinementOrchestrator — diagrams', () => {
  it('keeps a valid diagram renderable without losing nodes', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const beforeIR = extractIRFromArtifact({ content: validMermaid, representation: 'diagram', type: 'mermaid-graph' });
    const result = await refineArtifactBeforePersistence(baseRequest(diagramTemplate, validMermaid));
    const afterIR = extractIRFromArtifact({ content: result.content, representation: 'diagram', type: 'mermaid-graph' });

    expect(beforeIR?.nodes.length).toBeGreaterThan(0);
    expect(afterIR?.nodes.length ?? 0).toBeGreaterThanOrEqual(beforeIR?.nodes.length ?? 0);
    expect(result.finalScore).toBeGreaterThanOrEqual(result.initialScore);
  });

  it('produces a diagram that still renders in ReactFlow after refinement', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(diagramTemplate, validMermaid));
    const ir = extractIRFromArtifact({ content: result.content, representation: 'diagram', type: 'mermaid-graph' });
    expect(ir).not.toBeNull();
    expect(irToReactFlow(ir!, { allowEmptyPlaceholder: false }).nodes.length).toBeGreaterThan(0);
  });

  it('preserves exactly one Mermaid block for hybrid artifacts', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(hybridTemplate, hybrid));

    expect(result.content.match(/```mermaid/gi) ?? []).toHaveLength(1);
  });

  it('adds reading notes to a hybrid artifact that lacks them', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const terseHybrid = `# Vista\n\nBreve.\n\n\`\`\`mermaid\n${validMermaid}\`\`\`\n`;
    const result = await refineArtifactBeforePersistence(baseRequest(hybridTemplate, terseHybrid));

    expect(result.content).toMatch(/Notas de lectura/);
    expect(result.content.match(/```mermaid/gi) ?? []).toHaveLength(1);
  });
});

describe('artifactRefinementOrchestrator — tables', () => {
  it('preserves table headers and rows for a traceability matrix', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(tableTemplate, tableDraft, 'table'));

    expect(result.content).toContain('| ID | Requisito | Caso de prueba |');
    expect(result.content).toContain('| --- | --- | --- |');
    expect(result.content).toContain('| BR-01 | Autenticación de asegurados | TC-01 |');
    expect(result.content).toContain('| BR-02 | Procesamiento de pagos | TC-02 |');
  });
});

describe('isRefinedCandidateSafe — safety gate', () => {
  const diagramBaselineReport = () => buildArtifactQualityReport({
    id: 'a1', versionGroupId: 'vg1', version: 1, createdAt: 'now', name: diagramTemplate.name,
    type: diagramTemplate.type, phase: diagramTemplate.phase, architecturalView: diagramTemplate.architecturalView,
    content: validMermaid, objective: diagramTemplate.objective, keyConcepts: [], representation: 'diagram',
    ir: extractIRFromArtifact({ content: validMermaid, representation: 'diagram', type: 'mermaid-graph' }) ?? undefined,
  });

  const diagramContext = () => ({
    template: diagramTemplate,
    mode: 'diagram' as const,
    baselineContent: validMermaid,
    baselineEnvelope: envelopeFor(diagramTemplate, validMermaid),
    baselineReport: diagramBaselineReport(),
    baselineIR: extractIRFromArtifact({ content: validMermaid, representation: 'diagram', type: 'mermaid-graph' }) ?? undefined,
  });

  it('rejects an empty candidate', () => {
    expect(isRefinedCandidateSafe('   ', diagramContext()).ok).toBe(false);
  });

  it('rejects a diagram candidate that reduces nodes unjustifiably', () => {
    const reduced = 'graph LR\n  Usuario[Usuario] --> Portal[Portal]\n';
    const safety = isRefinedCandidateSafe(reduced, diagramContext());
    expect(safety.ok).toBe(false);
    expect(safety.reason).toMatch(/reduce nodos/i);
  });

  it('rejects a diagram candidate that reduces relations unjustifiably', () => {
    const fewerEdges = 'graph LR\n  Usuario[Usuario asegurado] --> Portal[Portal digital]\n  API[API de integración]\n  Core[Core de pólizas]\n';
    const safety = isRefinedCandidateSafe(fewerEdges, diagramContext());
    expect(safety.ok).toBe(false);
    expect(safety.reason).toMatch(/reduce relaciones/i);
  });

  it('rejects a document candidate that drops existing sections', () => {
    const baselineReport = buildArtifactQualityReport({
      id: 'd1', versionGroupId: 'vg1', version: 1, createdAt: 'now', name: docTemplate.name,
      type: docTemplate.type, phase: docTemplate.phase, architecturalView: docTemplate.architecturalView,
      content: wellStructuredDoc, objective: docTemplate.objective, keyConcepts: [], representation: 'document',
    });
    const stripped = '# Documento Ejecutivo\n\nUn único párrafo sin secciones que descarta toda la estructura previa del documento.';
    const safety = isRefinedCandidateSafe(stripped, {
      template: docTemplate,
      mode: 'document',
      baselineContent: wellStructuredDoc,
      baselineEnvelope: envelopeFor(docTemplate, wellStructuredDoc),
      baselineReport,
    });
    expect(safety.ok).toBe(false);
    expect(safety.reason).toMatch(/elimina secciones|contenido útil/i);
  });

  it('accepts a safe diagram candidate that keeps structure', () => {
    const safety = isRefinedCandidateSafe(validMermaid, diagramContext());
    expect(safety.ok).toBe(true);
  });
});

describe('artifactRefinementOrchestrator — fallback safety', () => {
  it('detects a skeleton fallback diagram and never marks it clean', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const skeleton = `flowchart LR\n${SKELETON_FALLBACK_MARKER}\n  A["Usuario"] --> B["Portal"]\n`;
    const result = await refineArtifactBeforePersistence(baseRequest(diagramTemplate, skeleton));

    expect(result.fallbackDetected).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/fallback/i);
    expect(result.diagnostics.some((step) => step.message.includes('skeleton-fallback'))).toBe(true);
    expect(result.content).toContain(SKELETON_FALLBACK_MARKER);
  });

  it('does not run the diagram quality gate on skeleton fallback content', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const skeleton = `flowchart LR\n${SKELETON_FALLBACK_MARKER}\n  A["Usuario"] --> B["Portal"]\n`;
    const result = await refineArtifactBeforePersistence(baseRequest(diagramTemplate, skeleton));

    expect(result.diagnostics.some((step) => step.message === 'refinement.diagram-quality-gate.skipped')).toBe(true);
  });

  it('skips AI refinement when the artifact is a deterministic fallback', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'true');
    const critiqueSpy = vi.spyOn(artifactGenerationService, 'critiqueArtifactContent');
    const skeleton = `flowchart LR\n${SKELETON_FALLBACK_MARKER}\n  A["Usuario"] --> B["Portal"]\n`;
    const result = await refineArtifactBeforePersistence({ ...baseRequest(diagramTemplate, skeleton), targetScore: 100 });

    expect(critiqueSpy).not.toHaveBeenCalled();
    expect(result.usedAI).toBe(false);
  });
});

describe('artifactRefinementOrchestrator — AI refinement', () => {
  it('keeps generation non-blocking when AI refinement fails', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'true');
    vi.spyOn(artifactGenerationService, 'critiqueArtifactContent').mockRejectedValue(new Error('quota exhausted'));
    const result = await refineArtifactBeforePersistence({ ...baseRequest(docTemplate, wellStructuredDoc), targetScore: 100, maxPasses: 3 });

    expect(result.content.trim().length).toBeGreaterThan(0);
    expect(result.safetyFailures).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some((step) => step.message.includes('failed-non-blocking'))).toBe(true);
  });

  it('rejects an empty AI candidate and stays safe', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'true');
    vi.spyOn(artifactGenerationService, 'critiqueArtifactContent').mockResolvedValue('1. Reforzar métricas.');
    vi.spyOn(artifactGenerationService, 'refineArtifactContent').mockResolvedValue('   ');
    const result = await refineArtifactBeforePersistence({ ...baseRequest(docTemplate, wellStructuredDoc), targetScore: 100, maxPasses: 3 });

    expect(result.usedAI).toBe(true);
    expect(result.rejectedCandidates).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some((step) => step.message === 'refinement.ai.rejected')).toBe(true);
  });

  it('accepts an AI candidate only when it passes the safety gate', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'true');
    vi.spyOn(artifactGenerationService, 'critiqueArtifactContent').mockResolvedValue('1. Añadir métricas medibles.');
    vi.spyOn(artifactGenerationService, 'refineArtifactContent').mockImplementation(async (req) =>
      `${req.content}\n\n## Métricas de éxito\nIndicadores claros, medibles y trazables del avance del portal de seguros.`);
    const result = await refineArtifactBeforePersistence({ ...baseRequest(docTemplate, wellStructuredDoc), targetScore: 100, maxPasses: 3 });

    expect(result.usedAI).toBe(true);
    expect(result.diagnostics.some((step) => step.message === 'refinement.ai.accepted')).toBe(true);
    expect(result.content).toContain('## Métricas de éxito');
  });
});

describe('artifactRefinementOrchestrator — observability', () => {
  it('records before/after metrics in the refinement result', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, 'Contenido breve sobre el portal.'));

    expect(typeof result.initialScore).toBe('number');
    expect(typeof result.finalScore).toBe('number');
    expect(result.finalScore).toBeGreaterThanOrEqual(result.initialScore);
    expect(Array.isArray(result.improvedDimensions)).toBe(true);
    expect(typeof result.rejectedCandidates).toBe('number');
    expect(typeof result.safetyFailures).toBe('number');
    expect(typeof result.fallbackDetected).toBe('boolean');
  });

  it('emits the structured refinement lifecycle events', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, 'Contenido breve sobre el portal.'));
    const messages = result.diagnostics.map((step) => step.message);

    expect(messages).toContain('refinement.started');
    expect(messages).toContain('refinement.baseline-evaluated');
    expect(messages.some((m) => m === 'refinement.accepted' || m === 'refinement.skipped')).toBe(true);
  });

  it('supports the "refinement" ArtifactGenerationStage without type errors', () => {
    const stage: ArtifactGenerationStage = 'refinement';
    expect(stage).toBe('refinement');
  });
});

describe('artifactRefinementOrchestrator — no regression', () => {
  it('runs for a catalog-intent template (no requestContext)', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const catalogTemplate: ArtifactTemplate = { ...docTemplate, requestContext: undefined };
    const result = await refineArtifactBeforePersistence(baseRequest(catalogTemplate, wellStructuredDoc));

    expect(result.envelope.quality.hasRenderableView).toBe(true);
    expect(result.qualityReport.score.value).toBeGreaterThanOrEqual(0);
  });

  it('keeps document exportability independent from diagram gates after refinement', async () => {
    vi.stubEnv('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', 'false');
    const result = await refineArtifactBeforePersistence(baseRequest(docTemplate, wellStructuredDoc));
    const snapshot = buildArtifactExportabilityState({
      id: 'doc-export', versionGroupId: 'doc-export', version: 1, createdAt: 'now', name: docTemplate.name,
      type: docTemplate.type, phase: docTemplate.phase, architecturalView: docTemplate.architecturalView,
      content: result.content, objective: docTemplate.objective, keyConcepts: [], representation: 'document',
    });

    expect(snapshot.state.document.passed).toBe(true);
    expect(snapshot.state.diagram.passed).toBe(false);
  });
});
