import type { ArtifactTemplate, Settings } from '../../types';
import type { Artifact, ArtifactGenerationPhaseListener, ArtifactGenerationTraceStatus, ArtifactGenerationTraceStep } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { DiagramErrorRecord, DiagramIR } from '../../lib/diagram';
import {
  normalizeArtifactEnvelope,
  validateArtifactEnvelope,
  type ArtifactEnvelope,
} from './artifactGenerationPipeline';
import { buildArtifactQualityReport } from '../quality/artifactQualityService';
import type { ArtifactQualityDimension, ArtifactQualityReport } from '../quality/artifactQualityModel';
import { buildArtifactExportabilityState } from '../quality/artifactQualityGateService';
import { extractIRFromArtifact } from '../diagram';
import { runDiagramQualityGate } from '../diagram/qualityGate';
import { irToMermaid } from '../diagram/irToMermaid';
import { irToReactFlow } from '../diagram/irToReactFlow';
import { artifactGenerationService } from '../ai';
import { markMermaidAsSkeletonFallback } from './deterministicArtifactFallbacks';
import {
  detectArtifactFallbackContent,
  markDocumentAsDeterministicFallback,
  markHybridAsDeterministicFallback,
  type ArtifactFallbackDetectionResult,
} from './artifactFallbackDetection';

export type ArtifactRefinementMode = 'document' | 'diagram' | 'hybrid' | 'table';

export interface ArtifactRefinementRequest {
  project: Project;
  template: ArtifactTemplate;
  settings: Settings;
  draftContent: string;
  previousArtifact?: Artifact;
  envelope: ArtifactEnvelope;
  targetScore?: number;
  maxPasses?: number;
  mode: ArtifactRefinementMode;
  operationId: string;
  onPhase?: ArtifactGenerationPhaseListener;
  /** Last recorded diagram failure — strengthens fallback detection. */
  lastDiagramError?: DiagramErrorRecord;
  /** Generation trace status known at refinement time — strengthens fallback detection. */
  generationTraceStatus?: ArtifactGenerationTraceStatus;
}

export type ArtifactRefinementStrategy =
  | 'deterministic'
  | 'ai-critique'
  | 'ai-refine'
  | 'diagram-quality-gate'
  | 'document-structure';

export interface ArtifactRefinementPass {
  passNumber: number;
  strategy: ArtifactRefinementStrategy;
  startedAt: string;
  completedAt: string;
  beforeScore: number;
  afterScore: number;
  issuesAddressed: string[];
  remainingIssues: string[];
  changed: boolean;
}

export interface ArtifactRefinementResult {
  content: string;
  envelope: ArtifactEnvelope;
  qualityReport: ArtifactQualityReport;
  initialScore: number;
  finalScore: number;
  accepted: boolean;
  acceptanceReason: string;
  passes: ArtifactRefinementPass[];
  warnings: string[];
  diagnostics: ArtifactGenerationTraceStep[];
  /** True when the draft content was identified as deterministic-fallback content. */
  fallbackDetected: boolean;
  /** Count of refined candidates discarded by the safety gate. */
  rejectedCandidates: number;
  /** Count of refinement passes that failed operationally (exceptions, AI errors). */
  safetyFailures: number;
  /** Quality dimensions whose score improved between baseline and final content. */
  improvedDimensions: string[];
  /** True when an AI critique/refine call was attempted. */
  usedAI: boolean;
}

interface CandidateSafetyContext {
  template: ArtifactTemplate;
  mode: ArtifactRefinementMode;
  baselineContent: string;
  baselineEnvelope: ArtifactEnvelope;
  baselineReport: ArtifactQualityReport;
  baselineIR?: DiagramIR;
  /** Pre-computed fallback detection for the baseline content. */
  baselineFallback?: ArtifactFallbackDetectionResult;
}

interface CandidateSafetyResult {
  ok: boolean;
  reason: string;
  envelope?: ArtifactEnvelope;
  report?: ArtifactQualityReport;
  ir?: DiagramIR;
  warnings: string[];
}

const now = (): string => new Date().toISOString();

const traceStep = (
  status: ArtifactGenerationTraceStep['status'],
  message: string,
  detail?: string,
): ArtifactGenerationTraceStep => ({
  stage: 'refinement',
  status,
  message,
  detail,
  at: now(),
});

const flagEnabled = (name: string, defaultValue: boolean): boolean => {
  const raw = (import.meta.env[name as keyof ImportMetaEnv] ?? String(defaultValue)).toString().trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
};

const intFlag = (name: string, defaultValue: number): number => {
  const raw = import.meta.env[name as keyof ImportMetaEnv];
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
};

export const isArtifactRefinementEnabled = (): boolean => flagEnabled('VITE_ARTIFACT_REFINEMENT_ENABLED', true);
export const isArtifactRefinementAIEnabled = (): boolean => flagEnabled('VITE_ARTIFACT_REFINEMENT_AI_ENABLED', false);
export const getArtifactRefinementMaxPasses = (): number => Math.min(4, intFlag('VITE_ARTIFACT_REFINEMENT_MAX_PASSES', 2));

const isDiagramMode = (mode: ArtifactRefinementMode): boolean => mode === 'diagram' || mode === 'hybrid';
const isDocumentishMode = (mode: ArtifactRefinementMode): boolean => mode === 'document' || mode === 'hybrid' || mode === 'table';

const artifactForQuality = (
  request: Pick<ArtifactRefinementRequest, 'project' | 'template'>,
  content: string,
  ir?: DiagramIR,
  id = 'refinement-candidate',
): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: now(),
  name: request.template.name,
  type: request.template.type,
  phase: request.template.phase,
  architecturalView: request.template.architecturalView,
  content,
  objective: request.template.objective,
  keyConcepts: request.template.keyConcepts,
  representation: request.template.representation,
  isFavorite: false,
  ...(ir ? { ir } : {}),
});

const buildReport = (request: Pick<ArtifactRefinementRequest, 'project' | 'template'>, content: string, ir?: DiagramIR): ArtifactQualityReport => {
  return buildArtifactQualityReport(artifactForQuality(request, content, ir));
};

const normalizeForRequest = (request: ArtifactRefinementRequest, content: string): ArtifactEnvelope => normalizeArtifactEnvelope({
  artifactId: request.envelope.id || request.operationId,
  title: request.template.name,
  artifactType: request.template.type,
  representation: request.template.representation,
  rawResponse: content,
  intent: request.template.requestContext ? 'on-demand' : 'catalog',
  audience: request.envelope.audience,
});

const issueMessages = (report: ArtifactQualityReport, limit = 8): string[] => [
  ...report.issues.map((issue) => `${issue.message} — ${issue.recommendation}`),
  ...report.recommendations.map((recommendation) => `${recommendation.title} — ${recommendation.detail}`),
].filter(Boolean).slice(0, limit);

/** Dimension labels whose score improved between the baseline and final report. */
const improvedDimensionLabels = (before: ArtifactQualityReport, after: ArtifactQualityReport): string[] => {
  const beforeById = new Map<string, ArtifactQualityDimension>(before.dimensions.map((d) => [d.id, d]));
  const improved: string[] = [];
  for (const dimension of after.dimensions) {
    const prior = beforeById.get(dimension.id);
    if (prior && dimension.score > prior.score) improved.push(dimension.label);
  }
  return improved;
};

const hasHeading = (content: string, label: string): boolean => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)#{1,3}\\s+${escaped}\\b`, 'i').test(content);
};

const extractHeadings = (content: string): string[] =>
  (content.match(/^#{1,6}\s+.+$/gm) ?? []).map((heading) => heading.replace(/^#+\s+/, '').trim().toLowerCase());

/** Count Markdown tables by their delimiter row (`| --- | --- |`). */
const countMarkdownTables = (content: string): number =>
  (content.match(/^\s*\|?[ :|]*-{3,}[ :|-]*\|?\s*$/gm) ?? []).length;

/** Count Markdown table data rows (header + delimiter excluded is approximate). */
const countTableRows = (content: string): number =>
  (content.match(/^\s*\|.*\|\s*$/gm) ?? []).length;

/** Generic placeholders that must never be introduced by a refinement pass. */
const countGenericPlaceholders = (content: string): number =>
  (content.match(/empresa x|sistema legacy|lorem ipsum|\[placeholder\]|insertar aquí|completar aquí|xxxxx/gi) ?? []).length;

const countMermaidBlocks = (content: string): number => (content.match(/```mermaid\s*[\s\S]*?```/gi) ?? []).length;

const hasSingleMermaidBlock = (content: string): boolean => countMermaidBlocks(content) === 1;

const withoutMermaidBlocks = (content: string): string => content.replace(/```mermaid\s*[\s\S]*?```/gi, '').trim();

/** Length of human-useful prose: strips diagram fences, markers and comments. */
const usefulTextLength = (content: string): number =>
  content
    .replace(/```mermaid\s*[\s\S]*?```/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/%%\s*arky:skeleton-fallback/gi, '')
    .trim().length;

/** Ratio of edges that carry a non-empty label. */
const labeledEdgeRatio = (ir: DiagramIR): number => {
  if (ir.edges.length === 0) return 0;
  const labeled = ir.edges.filter((edge) => (edge.label ?? '').trim().length > 0).length;
  return labeled / ir.edges.length;
};

const prependTitleIfMissing = (content: string, title: string): { content: string; changed: boolean; issues: string[] } => {
  if (/^#\s+\S+/m.test(content)) return { content, changed: false, issues: [] };
  return { content: `# ${title}\n\n${content.trim()}`, changed: true, issues: ['Se agregó título principal.'] };
};

const buildProjectContextSentence = (project: Project, template: ArtifactTemplate): string => {
  const context = [project.description, ...project.projectContext, ...project.initialCapture ?? []]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return context || `Artefacto ${template.name} para el proyecto ${project.name}.`;
};

const repairDocumentStructure = (request: ArtifactRefinementRequest, content: string): { content: string; issues: string[]; changed: boolean } => {
  const titleRepair = prependTitleIfMissing(content, request.template.name);
  let working = titleRepair.content.trim();
  const issues = [...titleRepair.issues];
  const criticalSections = [
    { heading: 'Propósito', body: buildProjectContextSentence(request.project, request.template) },
    { heading: 'Alcance', body: request.template.objective || `Cubre los elementos necesarios para ${request.template.name}.` },
    { heading: 'Supuestos', body: 'La información se basa en el contexto disponible del proyecto y debe validarse con los stakeholders responsables.' },
    { heading: 'Riesgos y consideraciones', body: 'Revisar dependencias, restricciones operativas, seguridad, datos e impactos de integración antes de ejecutar decisiones derivadas.' },
    { heading: 'Próximos pasos', body: 'Validar el contenido con el equipo, completar brechas identificadas y mantener trazabilidad con decisiones y requisitos relacionados.' },
  ];

  const nonDiagramContent = withoutMermaidBlocks(working);
  const isMonolithic = nonDiagramContent.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 0).length <= 1
    && nonDiagramContent.length > 180;

  for (const section of criticalSections) {
    if (!hasHeading(working, section.heading)) {
      working += `\n\n## ${section.heading}\n${section.body}`;
      issues.push(`Se agregó sección mínima: ${section.heading}.`);
    }
  }

  if (isMonolithic) {
    working += '\n\n## Nota de estructura\nEl contenido original fue recibido como un bloque monolítico; se añadieron secciones mínimas para facilitar revisión, trazabilidad y exportación.';
    issues.push('Se mitigó contenido monolítico agregando estructura revisable.');
  }

  const placeholderPattern = /\b(Empresa X|Sistema legacy|Ejemplo)\b/gi;
  if (placeholderPattern.test(working)) {
    working = working.replace(placeholderPattern, request.project.name);
    issues.push('Se reemplazaron placeholders genéricos por contexto del proyecto.');
  }

  return { content: working, issues, changed: working !== content.trim() };
};

const ensureHybridNarrative = (request: ArtifactRefinementRequest, content: string): { content: string; issues: string[]; changed: boolean } => {
  if (request.mode !== 'hybrid' || !hasSingleMermaidBlock(content)) return { content, issues: [], changed: false };
  const before = content;
  let working = content.trim();
  const issues: string[] = [];
  const narrative = withoutMermaidBlocks(working);
  if (narrative.length < 80 || !hasHeading(working, 'Notas de lectura')) {
    working += '\n\n## Notas de lectura\nEl diagrama resume componentes, relaciones y responsabilidades principales. Use las etiquetas de las relaciones para validar flujos críticos e integraciones.';
    issues.push('Se agregaron notas de lectura para el artefacto híbrido.');
  }
  if (!hasHeading(working, 'Supuestos')) {
    working += '\n\n## Supuestos\nLa vista combina narrativa y diagrama con base en el contexto disponible del proyecto; cualquier omisión debe validarse antes de compartir.';
    issues.push('Se agregó sección de supuestos para el artefacto híbrido.');
  }
  return { content: working, issues, changed: working !== before.trim() };
};

const replaceMermaidBlock = (content: string, mermaid: string): string => {
  const fenced = /```mermaid\s*[\s\S]*?```/m;
  if (fenced.test(content)) return content.replace(fenced, `\`\`\`mermaid\n${mermaid}\n\`\`\``);
  return mermaid;
};

const assertRenderableDiagram = (ir: DiagramIR): boolean => {
  if (ir.nodes.length === 0) return false;
  const rendered = irToReactFlow(ir, { allowEmptyPlaceholder: false });
  return rendered.nodes.length > 0;
};

/**
 * Guarantees a deterministic-fallback artifact never loses its fallback
 * signal through refinement: if a pass stripped every marker, the appropriate
 * marker is re-applied so the artifact stays detectable as a fallback.
 */
const preserveFallbackSignal = (
  content: string,
  mode: ArtifactRefinementMode,
  baselineFallback: ArtifactFallbackDetectionResult,
): { content: string; reMarked: boolean } => {
  if (!baselineFallback.isFallback) return { content, reMarked: false };
  if (detectArtifactFallbackContent({ content }).isFallback) return { content, reMarked: false };
  if (mode === 'diagram') return { content: markMermaidAsSkeletonFallback(content), reMarked: true };
  if (mode === 'hybrid') return { content: markHybridAsDeterministicFallback(content), reMarked: true };
  return { content: markDocumentAsDeterministicFallback(content), reMarked: true };
};

export const isRefinedCandidateSafe = (candidateContent: string, context: CandidateSafetyContext): CandidateSafetyResult => {
  const warnings: string[] = [];
  if (!candidateContent.trim()) return { ok: false, reason: 'La mejora propuesta está vacía.', warnings };

  const envelope = normalizeArtifactEnvelope({
    artifactId: context.baselineEnvelope.id,
    title: context.baselineEnvelope.title,
    artifactType: context.template.type,
    representation: context.template.representation,
    rawResponse: candidateContent,
    intent: context.baselineEnvelope.intent,
    audience: context.baselineEnvelope.audience,
  });
  const validation = validateArtifactEnvelope(envelope);
  if (!validation.ok || !envelope.quality.hasRenderableView) {
    return { ok: false, reason: 'La mejora propuesta no conserva una vista renderizable.', envelope, warnings };
  }

  // A fallback artifact may be improved, but the refinement must never strip
  // its fallback signal nor introduce a fallback signal that did not exist.
  const baselineFallback = context.baselineFallback
    ?? detectArtifactFallbackContent({ content: context.baselineContent });
  const candidateFallback = detectArtifactFallbackContent({ content: candidateContent });
  if (!baselineFallback.isFallback && candidateFallback.isFallback) {
    return { ok: false, reason: 'La mejora propuesta introduce señales de fallback inexistentes en el baseline.', envelope, warnings };
  }

  // Drastic loss of useful content (diagram fences and markers excluded).
  const baselineUseful = usefulTextLength(context.baselineContent);
  const candidateUseful = usefulTextLength(candidateContent);
  if (baselineUseful >= 200 && candidateUseful < baselineUseful * 0.55) {
    return {
      ok: false,
      reason: `La mejora propuesta reduce drásticamente el contenido útil (${candidateUseful} < 55% de ${baselineUseful}).`,
      envelope,
      warnings,
    };
  }

  let candidateIR: DiagramIR | undefined;
  if (isDiagramMode(context.mode)) {
    candidateIR = extractIRFromArtifact({ content: candidateContent, representation: context.template.representation, type: context.template.type }) ?? undefined;
    if (!candidateIR || candidateIR.nodes.length === 0) {
      return { ok: false, reason: 'La mejora propuesta no conserva IR diagramático con nodos.', envelope, warnings };
    }
    if (context.baselineIR) {
      if (candidateIR.nodes.length < context.baselineIR.nodes.length) {
        return { ok: false, reason: 'La mejora propuesta reduce nodos de forma injustificada.', envelope, ir: candidateIR, warnings };
      }
      if (candidateIR.edges.length < Math.max(0, context.baselineIR.edges.length - 1)) {
        return { ok: false, reason: 'La mejora propuesta reduce relaciones de forma injustificada.', envelope, ir: candidateIR, warnings };
      }
      const baselineLabelRatio = labeledEdgeRatio(context.baselineIR);
      if (baselineLabelRatio >= 0.6 && labeledEdgeRatio(candidateIR) < baselineLabelRatio * 0.5) {
        return { ok: false, reason: 'La mejora propuesta elimina etiquetas de relaciones que el baseline sí tenía.', envelope, ir: candidateIR, warnings };
      }
    }
    if (!assertRenderableDiagram(candidateIR)) {
      return { ok: false, reason: 'La mejora propuesta no pasa validación ReactFlow.', envelope, ir: candidateIR, warnings };
    }
  }

  if (context.mode === 'hybrid' && !hasSingleMermaidBlock(candidateContent)) {
    return { ok: false, reason: 'El híbrido refinado debe conservar exactamente un bloque Mermaid.', envelope, ir: candidateIR, warnings };
  }

  // Documents / hybrids / tables: never lose sections, tables or rows; never
  // introduce generic placeholders.
  if (isDocumentishMode(context.mode)) {
    const baselineHeadings = new Set(extractHeadings(context.baselineContent));
    const candidateHeadings = new Set(extractHeadings(candidateContent));
    const lostHeadings = [...baselineHeadings].filter((heading) => !candidateHeadings.has(heading));
    if (lostHeadings.length > 0) {
      return { ok: false, reason: `La mejora propuesta elimina secciones existentes (${lostHeadings.slice(0, 3).join(', ')}).`, envelope, ir: candidateIR, warnings };
    }
    const baselineTables = countMarkdownTables(context.baselineContent);
    if (countMarkdownTables(candidateContent) < baselineTables) {
      return { ok: false, reason: 'La mejora propuesta elimina tablas Markdown existentes.', envelope, ir: candidateIR, warnings };
    }
    if (baselineTables > 0 && countTableRows(candidateContent) < countTableRows(context.baselineContent)) {
      return { ok: false, reason: 'La mejora propuesta reduce filas de las tablas existentes.', envelope, ir: candidateIR, warnings };
    }
    if (countGenericPlaceholders(candidateContent) > countGenericPlaceholders(context.baselineContent)) {
      return { ok: false, reason: 'La mejora propuesta introduce placeholders genéricos.', envelope, ir: candidateIR, warnings };
    }
  }

  const report = buildArtifactQualityReport({
    ...artifactForQuality({ project: { id: 'safety', name: 'safety', description: '', projectContext: [], artifacts: [], createdAt: now(), updatedAt: now() }, template: context.template }, candidateContent, candidateIR),
  });
  if (report.score.value < context.baselineReport.score.value) {
    return { ok: false, reason: `La mejora propuesta reduce calidad (${report.score.value} < ${context.baselineReport.score.value}).`, envelope, report, ir: candidateIR, warnings };
  }

  return { ok: true, reason: 'Mejora segura.', envelope, report, ir: candidateIR, warnings };
};

const applyDiagramGate = (request: ArtifactRefinementRequest, content: string, baselineReport: ArtifactQualityReport, baselineIR?: DiagramIR): {
  content: string;
  ir?: DiagramIR;
  pass?: ArtifactRefinementPass;
  warnings: string[];
} => {
  const startedAt = now();
  const warnings: string[] = [];
  if (!baselineIR || baselineIR.nodes.length === 0) return { content, warnings: ['No hay IR diagramático suficiente para refinamiento determinístico.'] };

  const beforeScore = baselineReport.score.value;
  const gate = runDiagramQualityGate(baselineIR, {
    artifact: {
      name: request.template.name,
      type: request.template.type,
      objective: request.template.objective,
    },
    targetScore: request.targetScore ?? (request.mode === 'diagram' || request.mode === 'hybrid' ? 92 : 90),
    maxPasses: request.maxPasses ?? getArtifactRefinementMaxPasses(),
    aggressive: Boolean(request.template.requestContext),
  });
  if (gate.ir.nodes.length < baselineIR.nodes.length || gate.ir.edges.length < Math.max(0, baselineIR.edges.length - 1)) {
    warnings.push('refinement.discarded: el gate diagramático redujo nodos/aristas; se conserva el contenido previo.');
    return { content, ir: baselineIR, warnings };
  }
  const mermaid = irToMermaid(gate.ir);
  const candidate = request.mode === 'hybrid' ? replaceMermaidBlock(content, mermaid) : mermaid;
  const afterReport = buildReport(request, candidate, gate.ir);
  const changed = candidate.trim() !== content.trim();
  return {
    content: candidate,
    ir: gate.ir,
    warnings,
    pass: {
      passNumber: 1,
      strategy: 'diagram-quality-gate',
      startedAt,
      completedAt: now(),
      beforeScore,
      afterScore: afterReport.score.value,
      issuesAddressed: gate.changes.map((change) => change.description).slice(0, 12),
      remainingIssues: issueMessages(afterReport, 6),
      changed,
    },
  };
};

const runAIRefinement = async (
  request: ArtifactRefinementRequest,
  content: string,
  report: ArtifactQualityReport,
): Promise<{ content: string; pass: ArtifactRefinementPass; warnings: string[] }> => {
  const startedAt = now();
  const warnings: string[] = [];
  const issues = issueMessages(report, 8);
  const critique = await artifactGenerationService.critiqueArtifactContent({
    project: request.project,
    template: request.template,
    settings: request.settings,
    content,
    mode: request.mode,
    score: report.score.value,
    issues,
  });
  const refined = await artifactGenerationService.refineArtifactContent({
    project: request.project,
    template: request.template,
    settings: request.settings,
    content,
    mode: request.mode,
    score: report.score.value,
    issues,
    critique,
  });
  if (!refined.trim()) warnings.push('La IA devolvió contenido vacío durante refinamiento; se descartará por seguridad.');
  return {
    content: refined,
    warnings,
    pass: {
      passNumber: 2,
      strategy: 'ai-refine',
      startedAt,
      completedAt: now(),
      beforeScore: report.score.value,
      afterScore: report.score.value,
      issuesAddressed: issues,
      remainingIssues: [],
      changed: refined.trim() !== content.trim(),
    },
  };
};

export const refineArtifactBeforePersistence = async (request: ArtifactRefinementRequest): Promise<ArtifactRefinementResult> => {
  const diagnostics: ArtifactGenerationTraceStep[] = [];
  const warnings: string[] = [];
  const passes: ArtifactRefinementPass[] = [];
  let rejectedCandidates = 0;
  let safetyFailures = 0;
  let usedAI = false;
  const baselineIR = isDiagramMode(request.mode)
    ? extractIRFromArtifact({ content: request.draftContent, representation: request.template.representation, type: request.template.type }) ?? undefined
    : undefined;
  const initialReport = buildReport(request, request.draftContent, baselineIR);
  const fallback = detectArtifactFallbackContent({
    content: request.draftContent,
    irMetadata: baselineIR?.metadata,
    lastDiagramError: request.lastDiagramError,
    generationTraceStatus: request.generationTraceStatus,
  });
  let currentContent = request.draftContent;
  let currentEnvelope = request.envelope;
  let currentReport = initialReport;
  let currentIR = baselineIR;

  const baseResult = (overrides: Partial<ArtifactRefinementResult>): ArtifactRefinementResult => ({
    content: request.draftContent,
    envelope: request.envelope,
    qualityReport: initialReport,
    initialScore: initialReport.score.value,
    finalScore: initialReport.score.value,
    accepted: false,
    acceptanceReason: '',
    passes,
    warnings,
    diagnostics,
    fallbackDetected: fallback.isFallback,
    rejectedCandidates,
    safetyFailures,
    improvedDimensions: [],
    usedAI,
    ...overrides,
  });

  diagnostics.push(traceStep('in-progress', 'refinement.started', `score inicial ${initialReport.score.value}/100 · modo ${request.mode}.`));
  request.onPhase?.({
    stage: 'refinement',
    status: 'in-progress',
    message: 'Evaluando refinamiento semántico antes de persistir.',
    detail: `Score inicial ${initialReport.score.value}/100.`,
    at: now(),
    meta: { operationId: request.operationId, score: initialReport.score.value, mode: request.mode },
  });

  if (!isArtifactRefinementEnabled()) {
    diagnostics.push(traceStep('skipped', 'refinement.skipped', 'Feature flag VITE_ARTIFACT_REFINEMENT_ENABLED deshabilitado.'));
    return baseResult({ acceptanceReason: 'Refinamiento deshabilitado por feature flag.' });
  }

  diagnostics.push(traceStep(
    fallback.isFallback ? 'warning' : 'success',
    'refinement.baseline-evaluated',
    `score ${initialReport.score.value}/100 · modo ${request.mode} · fallback ${fallback.isFallback ? `sí — ${fallback.reasons.join(' ')}` : 'no'}.`,
  ));

  if (fallback.isFallback) {
    warnings.push(`Fallback determinístico detectado (${fallback.isSkeleton ? 'skeleton' : 'documento'}): se mantiene observable y no se marca como resultado limpio.`);
    diagnostics.push(traceStep(
      'warning',
      'refinement.skeleton-fallback',
      `El refinamiento conserva la marca de fallback, omite mejoras destructivas y recomienda regeneración. ${fallback.reasons.join(' ')}`,
    ));
  }

  try {
    const targetScore = request.targetScore ?? (request.mode === 'diagram' || request.mode === 'hybrid' ? 92 : 90);
    const exportability = buildArtifactExportabilityState(artifactForQuality(request, currentContent, currentIR), { report: currentReport });
    if (request.mode === 'document' && !exportability.state.document.passed) {
      diagnostics.push(traceStep('warning', 'refinement.quality-before', exportability.state.document.message));
    }

    if (isDocumentishMode(request.mode)) {
      const startedAt = now();
      const structured = repairDocumentStructure(request, currentContent);
      const hybrid = request.mode === 'hybrid' ? ensureHybridNarrative(request, structured.content) : { content: structured.content, issues: [], changed: false };
      const candidate = hybrid.content;
      const afterIR = request.mode === 'hybrid'
        ? extractIRFromArtifact({ content: candidate, representation: request.template.representation, type: request.template.type }) ?? currentIR
        : currentIR;
      const afterReport = buildReport(request, candidate, afterIR);
      const pass: ArtifactRefinementPass = {
        passNumber: passes.length + 1,
        strategy: request.mode === 'hybrid' ? 'deterministic' : 'document-structure',
        startedAt,
        completedAt: now(),
        beforeScore: currentReport.score.value,
        afterScore: afterReport.score.value,
        issuesAddressed: [...structured.issues, ...hybrid.issues],
        remainingIssues: issueMessages(afterReport, 6),
        changed: structured.changed || hybrid.changed,
      };
      if (pass.changed) {
        const safety = isRefinedCandidateSafe(candidate, {
          template: request.template,
          mode: request.mode,
          baselineContent: currentContent,
          baselineEnvelope: currentEnvelope,
          baselineReport: currentReport,
          baselineIR: currentIR,
          baselineFallback: fallback,
        });
        if (safety.ok && safety.report && safety.envelope) {
          currentContent = candidate;
          currentEnvelope = safety.envelope;
          currentReport = safety.report;
          currentIR = safety.ir ?? afterIR;
          passes.push({ ...pass, afterScore: safety.report.score.value, remainingIssues: issueMessages(safety.report, 6) });
          diagnostics.push(traceStep('success', 'refinement.document-structure.applied', `${pass.strategy}: ${pass.issuesAddressed.length} ajuste(s). score ${pass.beforeScore} → ${safety.report.score.value}.`));
        } else {
          rejectedCandidates += 1;
          warnings.push(`refinement.discarded: ${safety.reason}`);
          diagnostics.push(traceStep('warning', 'refinement.candidate.discarded', `Se descartó mejora determinística por seguridad. ${safety.reason}`));
        }
      }
    }

    if (isDiagramMode(request.mode) && fallback.isFallback) {
      diagnostics.push(traceStep('skipped', 'refinement.diagram-quality-gate.skipped', 'Diagrama de fallback determinístico: se conserva tal cual para no presentarlo como limpio.'));
    } else if (isDiagramMode(request.mode)) {
      const diagram = applyDiagramGate(request, currentContent, currentReport, currentIR);
      warnings.push(...diagram.warnings);
      if (diagram.pass) {
        const candidateEnvelope = normalizeForRequest(request, diagram.content);
        const safety = isRefinedCandidateSafe(diagram.content, {
          template: request.template,
          mode: request.mode,
          baselineContent: currentContent,
          baselineEnvelope: currentEnvelope,
          baselineReport: currentReport,
          baselineIR: currentIR,
          baselineFallback: fallback,
        });
        if (safety.ok && safety.report && safety.envelope) {
          currentContent = diagram.content;
          currentEnvelope = safety.envelope ?? candidateEnvelope;
          currentReport = safety.report;
          currentIR = safety.ir ?? diagram.ir;
          passes.push({ ...diagram.pass, passNumber: passes.length + 1, afterScore: safety.report.score.value, remainingIssues: issueMessages(safety.report, 6) });
          diagnostics.push(traceStep('success', 'refinement.diagram-quality-gate.applied', `diagram-quality-gate aplicado antes de persistir. score ${diagram.pass.beforeScore} → ${safety.report.score.value}.`));
        } else {
          rejectedCandidates += 1;
          warnings.push(`refinement.discarded: ${safety.reason}`);
          diagnostics.push(traceStep('warning', 'refinement.candidate.discarded', `Se descartó mejora diagramática por seguridad. ${safety.reason}`));
        }
      }
    }

    const aiEnabled = isArtifactRefinementAIEnabled();
    const shouldUseAI = aiEnabled
      && !fallback.isFallback
      && passes.length < (request.maxPasses ?? getArtifactRefinementMaxPasses())
      && currentReport.score.value < targetScore
      && issueMessages(currentReport, 1).length > 0;

    if (shouldUseAI) {
      usedAI = true;
      diagnostics.push(traceStep('in-progress', 'refinement.ai.started', `Refinamiento IA solicitado: score ${currentReport.score.value}/${targetScore}.`));
      try {
        const ai = await runAIRefinement(request, currentContent, currentReport);
        warnings.push(...ai.warnings);
        const safety = isRefinedCandidateSafe(ai.content, {
          template: request.template,
          mode: request.mode,
          baselineContent: currentContent,
          baselineEnvelope: currentEnvelope,
          baselineReport: currentReport,
          baselineIR: currentIR,
          baselineFallback: fallback,
        });
        if (safety.ok && safety.report && safety.envelope) {
          currentContent = ai.content;
          currentEnvelope = safety.envelope;
          currentReport = safety.report;
          currentIR = safety.ir ?? currentIR;
          passes.push({ ...ai.pass, passNumber: passes.length + 1, afterScore: safety.report.score.value, remainingIssues: issueMessages(safety.report, 6) });
          diagnostics.push(traceStep('success', 'refinement.ai.accepted', `ai-refine aceptado por mejorar sin romper renderización. score ${ai.pass.beforeScore} → ${safety.report.score.value}.`));
        } else {
          rejectedCandidates += 1;
          warnings.push(`refinement.discarded: ${safety.reason}`);
          diagnostics.push(traceStep('warning', 'refinement.ai.rejected', `Se descartó refinamiento IA por seguridad. ${safety.reason}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safetyFailures += 1;
        warnings.push(`refinement.ai.failed: ${message}`);
        diagnostics.push(traceStep('warning', 'refinement.failed-non-blocking', `El refinamiento IA falló; se conserva contenido validado. ${message}`));
      }
    } else {
      const reason = !aiEnabled
        ? 'Refinamiento IA deshabilitado por feature flag.'
        : fallback.isFallback
          ? 'Refinamiento IA omitido: el artefacto proviene de fallback determinístico.'
          : 'IA no aporta valor adicional o ya se alcanzó el target.';
      diagnostics.push(traceStep('skipped', 'refinement.ai.skipped', reason));
    }

    // Guarantee a fallback artifact never loses its fallback signal.
    if (fallback.isFallback) {
      const preserved = preserveFallbackSignal(currentContent, request.mode, fallback);
      if (preserved.reMarked) {
        currentContent = preserved.content;
        currentEnvelope = normalizeForRequest(request, currentContent);
        warnings.push('refinement.fallback-signal-restored: se restauró el marcador de fallback eliminado por una pasada.');
        diagnostics.push(traceStep('warning', 'refinement.skeleton-fallback', 'Se restauró el marcador de fallback para que el artefacto no se presente como limpio.'));
      }
    }

    const improvedDimensions = improvedDimensionLabels(initialReport, currentReport);
    const accepted = currentContent.trim() !== request.draftContent.trim() && currentReport.score.value >= initialReport.score.value;
    diagnostics.push(traceStep(
      accepted ? 'success' : 'skipped',
      accepted ? 'refinement.accepted' : 'refinement.skipped',
      `${accepted ? 'Se aceptó contenido refinado antes de persistir.' : 'No se aplicaron cambios de refinamiento; se conserva contenido validado.'} score ${initialReport.score.value} → ${currentReport.score.value} · pasadas ${passes.length} · descartes ${rejectedCandidates}.`,
    ));
    request.onPhase?.({
      stage: 'refinement',
      status: warnings.length > 0 ? 'warning' : 'success',
      message: accepted ? 'Refinamiento completado y aceptado.' : 'Refinamiento evaluado sin cambios seguros necesarios.',
      detail: `Score ${initialReport.score.value} → ${currentReport.score.value}.`,
      at: now(),
      meta: {
        operationId: request.operationId,
        initialScore: initialReport.score.value,
        finalScore: currentReport.score.value,
        passes: passes.length,
        fallback: fallback.isFallback,
        rejected: rejectedCandidates,
      },
    });

    return baseResult({
      content: accepted ? currentContent : request.draftContent,
      envelope: accepted ? currentEnvelope : request.envelope,
      qualityReport: accepted ? currentReport : initialReport,
      finalScore: accepted ? currentReport.score.value : initialReport.score.value,
      accepted,
      acceptanceReason: accepted ? 'Mejora segura aceptada.' : 'No hubo mejora segura que justificara reemplazar el contenido.',
      improvedDimensions: accepted ? improvedDimensions : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    safetyFailures += 1;
    warnings.push(`refinement.failed: ${message}`);
    diagnostics.push(traceStep('warning', 'refinement.failed-non-blocking', `El refinamiento falló de forma no bloqueante; se conserva contenido validado. ${message}`));
    return baseResult({ acceptanceReason: 'Refinamiento falló de forma no bloqueante; se conserva contenido original validado.' });
  }
};
