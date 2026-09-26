/**
 * Wires the Architecture Office runner to the application's real generation
 * and validation machinery.
 *
 * The runner deliberately knows nothing about Gemini, Firestore or React. This
 * module is the only place where those meet, and it does so by **reusing** the
 * paths that are already hardened rather than opening a second one:
 *
 *  - production goes through `executeAgentAction`, the same route the
 *    Arquitecto Agente uses, so an office-produced artifact inherits the
 *    governance pre-flight, the pre-persistence quality gate, the diagram IR
 *    repair and the `AgentActionRecord` audit entry;
 *  - review starts from **deterministic** evidence (`validateOfficeArtifact`
 *    plus the artifact compiler) and only then asks the reviewer persona for a
 *    judgement. A blocking validator outranks any model opinion — the model
 *    cannot approve away a broken contract.
 */

import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import {
  planAgentAction,
  executeAgentAction,
  type AgentArtifactStore,
  type AgentIntent,
} from '../../agent';
import { compileArtifact } from '../../artifactCompiler';
import { parseStructured } from '../../ai/structuredOutput';
import { validateOfficeArtifact } from '../domain/officeArtifactValidators';
import { newPrefixedId } from '../../../lib/ids';
import { OFFICE_AGENT_PERSONAS, officePersonaForMessage, type OfficeAgentId } from '../domain/officeAgentPersonas';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';
import type {
  OfficeConsolidateOutcome,
  OfficeProduceOutcome,
  OfficeRunnerPorts,
} from '../application/OfficeEngagementRunner';
import type { PersistenceResult } from '../../persistence';
import type {
  OfficeEngagement,
  OfficeFindingSeverity,
  OfficeReviewFinding,
  OfficeTask,
  OfficeTaskReview,
} from '../domain/OfficeTypes';

/**
 * Chat entry point used for review and consolidation. The persona travels as
 * an argument, never inside the prompt text — see `chatWithProject`.
 */
export type OfficePersonaInvoker = (
  personaId: OfficeAgentId,
  prompt: string,
  project: Project,
) => Promise<string>;

export interface OfficeRunnerAdapterDeps {
  /** Reads the *current* project — the runner mutates it as artifacts land. */
  getProject: () => Project | undefined;
  getSettings: () => Settings;
  store: AgentArtifactStore;
  invokePersona: OfficePersonaInvoker;
  /**
   * Escribe el punto de recuperación y dice cómo fue. Ver
   * `OfficeRunnerPorts.persist`: un puerto que no puede decir que falló obliga
   * al runner a suponer que todo se guardó.
   */
  persist: (engagement: OfficeEngagement) => Promise<PersistenceResult<OfficeEngagement>>;
  onProgress?: (engagement: OfficeEngagement) => void;
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/**
 * Synthetic anchor so `planAgentAction` has an artifact to hang the plan on.
 * `artifact.create` never reads its content — it is a signature requirement.
 * Mirrors the anchor `useAgentActions` builds for creation from chat.
 */
const createOfficeAnchorArtifact = (task: OfficeTask): Artifact => ({
  id: `office-anchor-${task.id}`,
  versionGroupId: `office-anchor-${task.id}`,
  version: 1,
  createdAt: new Date().toISOString(),
  name: task.title,
  type: 'markdown',
  phase: '—',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '',
  objective: 'Anclaje sintético para una tarea de producción de la Oficina.',
  keyConcepts: [],
  representation: 'document',
});

/**
 * Composes the instruction the producing persona works from: its own mandate,
 * the office standards it is accountable for, the acceptance criteria, and —
 * on a retry — the reviewer's findings verbatim.
 */
export const buildProductionInstruction = (task: OfficeTask, engagement: OfficeEngagement): string => {
  const persona = OFFICE_AGENT_PERSONAS[task.assigneeId];
  const standards = getOfficeArchitectureContext().standards
    .filter((standard) => persona.standardIds.includes(standard.id))
    .map((standard) => `- [${standard.id}] ${standard.statement}`);

  const lines = [
    `Entregable: ${engagement.title}`,
    `Solicitud original: ${engagement.brief}`,
    '',
    `Actúas como ${persona.alias} — ${persona.role}.`,
    persona.instruction,
    '',
    `Entregable: ${task.artifactTemplateName ?? task.title}.`,
    task.objective,
  ];

  if (engagement.charter.constraints.length > 0) {
    lines.push('', 'Restricciones del entregable:', ...engagement.charter.constraints.map((item) => `- ${item}`));
  }
  if (standards.length > 0) {
    lines.push('', 'Estándares que debes cumplir:', ...standards);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push('', 'Criterios de aceptación:', ...task.acceptanceCriteria.map((item) => `- ${item}`));
  }
  if (task.carriedFindings && task.carriedFindings.length > 0) {
    lines.push(
      '',
      'La revisión anterior pidió cambios. Corrige exactamente estos hallazgos:',
      ...task.carriedFindings.map((finding) => `- [${finding.severity}] ${finding.message}`),
    );
  }
  lines.push('', 'No inventes evidencia: cuando falte un insumo, declara el supuesto de forma explícita.');

  return lines.join('\n');
};

const buildCreateIntent = (task: OfficeTask, engagement: OfficeEngagement): AgentIntent => ({
  type: 'artifact.create',
  confidence: 1,
  userInstruction: buildProductionInstruction(task, engagement),
  artifactId: null,
  artifactVersionGroupId: null,
  artifactViewContext: null,
  extractedRequirements: [...task.acceptanceCriteria],
  requiresConfirmation: false,
  impact: 'medium',
  suggestedTarget: 'new_version',
  createHint: {
    templateName: task.artifactTemplateName ?? null,
    artifactType: task.targetArtifactType,
    objective: task.objective,
    // La identidad del artefacto sale de la identidad del intento de tarea:
    // reintentar la misma ejecución encuentra lo ya creado en vez de duplicar.
    deterministicArtifactId: task.executionId
      ? `office-art-${task.executionId}`
      : null,
  },
});

export const createProduceArtifactPort = (deps: OfficeRunnerAdapterDeps) =>
  async (task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeProduceOutcome> => {
    const project = deps.getProject();
    if (!project) {
      return { status: 'failed', message: 'El proyecto del entregable ya no está disponible.' };
    }

    const anchor = createOfficeAnchorArtifact(task);
    const plan = planAgentAction({
      intent: buildCreateIntent(task, engagement),
      artifact: anchor,
      project,
    });

    const result = await executeAgentAction({
      plan,
      artifact: anchor,
      project,
      settings: deps.getSettings(),
      history: [],
      store: deps.store,
      resolvePersona: officePersonaForMessage,
      actor: {
        id: task.assigneeId,
        name: OFFICE_AGENT_PERSONAS[task.assigneeId].alias,
      },
    });

    if (result.status !== 'success' || !result.newArtifactId) {
      return {
        status: 'failed',
        aiCalls: 1,
        // Reported on failure too: a run that produced nothing is exactly when
        // the trace is worth having.
        traceId: result.traceId,
        message: result.messages[0] ?? result.errors[0] ?? 'La generación no produjo un artefacto utilizable.',
      };
    }

    return {
      status: 'success',
      artifactId: result.newArtifactId,
      versionGroupId: result.newArtifactVersionId ?? result.newArtifactId,
      aiCalls: 1,
      // The thread back to `projects/{id}/agent_actions/{traceId}`: the prompt,
      // the phases, the versions and the rollback of the generation that made
      // this deliverable. It was being discarded here.
      traceId: result.traceId,
    };
  };

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

interface ModelCritique {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
}

const SEVERITIES: readonly OfficeFindingSeverity[] = ['critical', 'high', 'medium', 'low'];

const asSeverity = (value: unknown): OfficeFindingSeverity =>
  SEVERITIES.includes(value as OfficeFindingSeverity) ? (value as OfficeFindingSeverity) : 'medium';

/**
 * Deterministic evidence gathered before the reviewer persona is consulted.
 * Exported so the review verdict can be reproduced in a test without any AI.
 */
export interface DeterministicReviewEvidence {
  findings: OfficeReviewFinding[];
  blockingValidatorIds: string[];
  score?: number;
  blocking: boolean;
}

export const gatherDeterministicEvidence = (artifact: Artifact): DeterministicReviewEvidence => {
  const findings: OfficeReviewFinding[] = [];
  const blockingValidatorIds: string[] = [];

  const validation = validateOfficeArtifact(artifact);
  for (const result of validation.results) {
    if (!result.passed) blockingValidatorIds.push(result.validatorId);
    for (const issue of result.issues) {
      findings.push({
        severity: issue.severity === 'error' ? 'high' : 'medium',
        message: issue.message,
        evidence: `${result.validatorId}:${issue.code}`,
      });
    }
  }

  // `applyRepairs: false` — the reviewer reports what the producer actually
  // delivered, not what auto-repair could have salvaged.
  const compilation = compileArtifact(artifact, { applyRepairs: false, source: 'manual' });
  const score = compilation.score.value;
  for (const issue of compilation.issues.critical) {
    findings.push({ severity: 'critical', message: issue.message, evidence: compilation.contractId });
  }
  for (const issue of compilation.issues.high) {
    findings.push({ severity: 'high', message: issue.message, evidence: compilation.contractId });
  }

  return {
    findings,
    blockingValidatorIds,
    score,
    blocking: validation.blocking || compilation.issues.critical.length > 0,
  };
};

export const buildReviewPrompt = (
  task: OfficeTask,
  artifact: Artifact,
  evidence: DeterministicReviewEvidence,
): string => {
  const persona = OFFICE_AGENT_PERSONAS[task.assigneeId];
  return [
    `Actúas como ${persona.alias} — ${persona.role}. Revisas el trabajo de otro arquitecto de la Oficina.`,
    persona.instruction,
    '',
    `ARTEFACTO: ${artifact.name} (${artifact.type})`,
    `OBJETIVO DECLARADO: ${artifact.objective}`,
    '',
    'CONTENIDO:',
    artifact.content.slice(0, 12_000),
    '',
    'CRITERIOS DE ACEPTACIÓN:',
    ...task.acceptanceCriteria.map((item) => `- ${item}`),
    '',
    'HALLAZGOS DETERMINISTAS YA DETECTADOS (no los repitas, complétalos):',
    evidence.findings.length > 0
      ? evidence.findings.map((finding) => `- [${finding.severity}] ${finding.message}`).join('\n')
      : '- ninguno',
    evidence.score !== undefined ? `\nPUNTUACIÓN DEL COMPILADOR: ${evidence.score}/100` : '',
    '',
    'Emite un veredicto sobre si el artefacto es utilizable como entregable de la Oficina.',
    'No inventes defectos: cada hallazgo debe citar algo presente o ausente en el contenido.',
    'Responde únicamente con JSON: {"verdict":"approved"|"changes-requested"|"rejected","summary":"...","findings":[{"severity":"critical"|"high"|"medium"|"low","message":"...","evidence":"..."}]}',
  ].join('\n');
};

export const createReviewArtifactPort = (deps: OfficeRunnerAdapterDeps) =>
  async (task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeTaskReview> => {
    const decidedAt = new Date().toISOString();
    // Minted by the Office: the review path reaches the model through the legacy
    // chat façade, which returns no trace of its own. See `OfficeTask.traceIds`.
    const traceId = newPrefixedId('office-review');
    const project = deps.getProject();
    const producer = engagement.tasks.find((candidate) => candidate.id === task.reviewsTaskId);
    const artifact = project && producer?.producedArtifactId
      ? project.artifacts.find((candidate) => candidate.id === producer.producedArtifactId)
      : undefined;

    if (!artifact) {
      return {
        reviewerId: task.assigneeId,
        traceId,
        verdict: 'changes-requested',
        findings: [{ severity: 'critical', message: 'El artefacto a revisar no está disponible en el proyecto.' }],
        summary: 'No hay artefacto que revisar.',
        decidedAt,
      };
    }

    const evidence = gatherDeterministicEvidence(artifact);

    let critique: ModelCritique | undefined;
    try {
      const raw = await deps.invokePersona(
        task.assigneeId,
        buildReviewPrompt(task, artifact, evidence),
        project!,
      );
      const parsed = parseStructured<ModelCritique>(raw);
      if (parsed.ok) critique = parsed.value;
    } catch {
      // A reviewer that cannot be reached must not silently approve. The
      // deterministic evidence below still decides the verdict.
    }

    const modelFindings: OfficeReviewFinding[] = Array.isArray(critique?.findings)
      ? (critique!.findings as Record<string, unknown>[])
        .filter((item) => item && typeof item === 'object' && typeof item.message === 'string')
        .map((item) => ({
          severity: asSeverity(item.severity),
          message: item.message as string,
          evidence: typeof item.evidence === 'string' ? item.evidence : undefined,
        }))
      : [];

    const findings = [...evidence.findings, ...modelFindings];
    const modelVerdict = critique?.verdict;

    // Deterministic evidence outranks the model: a blocking validator or a
    // critical contract issue is `changes-requested` whatever the model said.
    const verdict: OfficeTaskReview['verdict'] = evidence.blocking
      ? 'changes-requested'
      : modelVerdict === 'rejected'
        ? 'rejected'
        : modelVerdict === 'changes-requested'
          ? 'changes-requested'
          : findings.some((finding) => finding.severity === 'critical')
            ? 'changes-requested'
            : 'approved';

    return {
      reviewerId: task.assigneeId,
      traceId,
      verdict,
      findings,
      deterministicScore: evidence.score,
      blockingValidatorIds: evidence.blockingValidatorIds,
      summary: typeof critique?.summary === 'string' && critique.summary.trim().length > 0
        ? critique.summary
        : verdict === 'approved'
          ? 'El entregable cumple su contrato y los criterios de aceptación.'
          : 'El entregable necesita correcciones antes de avanzar.',
      decidedAt,
    };
  };

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export const buildConsolidationPrompt = (engagement: OfficeEngagement): string => {
  const persona = OFFICE_AGENT_PERSONAS[engagement.charter.consolidatorId];
  const deliverables = engagement.tasks
    .filter((task) => task.kind === 'produce-artifact')
    .map((task) => {
      const review = engagement.tasks.find((candidate) => candidate.reviewsTaskId === task.id)?.review;
      return [
        `### ${task.title} — ${OFFICE_AGENT_PERSONAS[task.assigneeId].alias} (${task.status})`,
        review ? `Revisión de ${OFFICE_AGENT_PERSONAS[review.reviewerId].alias}: ${review.verdict} — ${review.summary}` : 'Sin revisión registrada.',
        task.error ? `Error: ${task.error}` : '',
      ].filter(Boolean).join('\n');
    });

  return [
    `Actúas como ${persona.alias} — ${persona.role}.`,
    persona.instruction,
    '',
    `Consolida el entregable "${engagement.title}".`,
    `Solicitud original: ${engagement.brief}`,
    '',
    'ENTREGABLES Y SUS REVISIONES:',
    ...deliverables,
    '',
    'Compara los dominios, resuelve o escala las contradicciones con dueño, y cierra con un veredicto Ready, Conditional o Blocked justificado con evidencia concreta.',
    'No inventes evidencia. Si un entregable falló, dilo y explica la consecuencia.',
  ].join('\n');
};

export const createConsolidatePort = (deps: OfficeRunnerAdapterDeps) =>
  async (task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeConsolidateOutcome> => {
    const project = deps.getProject();
    if (!project) {
      return { status: 'failed', summary: 'El proyecto del entregable ya no está disponible.' };
    }
    // Minted here, not returned by the model call: this path reaches the model
    // through the legacy chat façade, which carries no trace id. It identifies
    // the invocation inside its run — it does not join to an agent action, and
    // `OfficeTask.traceIds` says so.
    const traceId = newPrefixedId('office-consolidate');
    try {
      const summary = await deps.invokePersona(
        task.assigneeId,
        buildConsolidationPrompt(engagement),
        project,
      );
      return {
        status: 'success',
        summary: summary.trim() || 'Consolidación sin contenido.',
        aiCalls: 1,
        traceId,
      };
    } catch (error) {
      return {
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        aiCalls: 1,
        traceId,
      };
    }
  };

// ---------------------------------------------------------------------------

export const createOfficeRunnerPorts = (deps: OfficeRunnerAdapterDeps): OfficeRunnerPorts => ({
  produceArtifact: createProduceArtifactPort(deps),
  reviewArtifact: createReviewArtifactPort(deps),
  consolidate: createConsolidatePort(deps),
  persist: deps.persist,
  onProgress: deps.onProgress,
});
