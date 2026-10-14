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
import type { Artifact, ArtifactBusinessMotivation } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import {
  planAgentAction,
  executeAgentAction,
  type AgentIntent,
} from '../../agent';
import { parseStructured } from '../../ai/structuredOutput';
import { newPrefixedId } from '../../../lib/ids';
import { createConsolidatePort, measurementOf } from './officeConsolidationPort';
import { REVIEW_CONTENT_LIMIT, buildReviewPrompt, gatherDeterministicEvidence } from './officeReviewPrompt';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { agentPromptRef, stampPrompt } from '../../../lib/agents/promptCatalog';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from '../domain/officeAgentPersonas';
import { buildOfficePersonaBriefing } from '../domain/officePersonaBriefing';
import type { OfficeAgentProfile } from '../domain/officeAgentProfile';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';
import type {
  OfficeProduceOutcome,
  OfficeRunnerPorts,
} from '../application/OfficeEngagementRunner';
import type { PersistenceResult } from '../../persistence';
import type { AgentInvocationResult, AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import type { AgentArtifactStoreLike } from '../../agent';
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
  /** La ficha resuelta del agente (`getProfile`), para su prompt de sistema. */
  profile?: OfficeAgentProfile,
) => Promise<string | AgentInvocationResult>;


export interface OfficeRunnerAdapterDeps {
  /** Reads the *current* project — the runner mutates it as artifacts land. */
  getProject: () => Project | undefined;
  getSettings: () => Settings;
  store: AgentArtifactStoreLike;
  invokePersona: OfficePersonaInvoker;
  /**
   * Escribe el punto de recuperación y dice cómo fue. Ver
   * `OfficeRunnerPorts.persist`: un puerto que no puede decir que falló obliga
   * al runner a suponer que todo se guardó.
   */
  persist: (engagement: OfficeEngagement) => Promise<PersistenceResult<OfficeEngagement>>;
  onProgress?: (engagement: OfficeEngagement) => void;
  /** Why the project exists (the initiatives it answers); the Office cannot resolve the portfolio itself. */
  getBusinessMotivation?: (project: Project) => readonly ArtifactBusinessMotivation[];
  /**
   * La ficha resuelta de un agente, cuando quien monta el runner la tiene. Sin
   * ella el agente produce con su persona de fábrica (plan de agentes, 16.1).
   */
  getProfile?: (agentId: OfficeAgentId) => OfficeAgentProfile | undefined;
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
    // El brief es texto de una persona: viaja vallado (plan de agentes, 17.0).
    wrapUntrustedContent('solicitud original', engagement.brief),
    '',
    // Quién eres no va aquí: va en el prompt de sistema, compuesto desde la
    // ficha del asignado (`buildOfficePersonaBriefing`). Repetirlo en el turno
    // era darle al agente dos identidades (plan de agentes, 16.0).
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
    const intent = buildCreateIntent(task, engagement);
    const promptStamp = stampPrompt(agentPromptRef('office.production'), intent.userInstruction);
    const plan = planAgentAction({
      intent,
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
      // Quien firma la tarea lo decide la tarea. Resolverlo del texto —que
      // empieza por el brief del usuario— dejaba que un «@Carmen» en el brief
      // cambiara el autor, y sin mención firmaba Arky (plan de agentes, A7).
      resolvePersona: () => buildOfficePersonaBriefing(task.assigneeId, deps.getProfile?.(task.assigneeId)),
      businessMotivation: deps.getBusinessMotivation?.(project),
      actor: {
        id: task.assigneeId,
        name: OFFICE_AGENT_PERSONAS[task.assigneeId].alias,
      },
    });

    if (result.status !== 'success' || !result.newArtifactId) {
      return {
        status: 'failed',
        aiCalls: result.aiCalls ?? 1,
        // Reported on failure too: a run that produced nothing is exactly when
        // the trace is worth having.
        traceId: result.traceId,
        promptStamp,
        message: result.messages[0] ?? result.errors[0] ?? 'La generación no produjo un artefacto utilizable.',
      };
    }

    return {
      status: 'success',
      artifactId: result.newArtifactId,
      versionGroupId: result.newArtifactVersionId ?? result.newArtifactId,
      aiCalls: result.aiCalls ?? 1,
      // The thread back to `projects/{id}/agent_actions/{traceId}`: the prompt,
      // the phases, the versions and the rollback of the generation that made
      // this deliverable. It was being discarded here.
      traceId: result.traceId,
      promptStamp,
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
// La evidencia determinista y el prompt de la revisión viven en
// `officeReviewPrompt.ts` (separados cuando este fichero pasó su techo).
export {
  REVIEW_CONTENT_LIMIT,
  buildReviewPrompt,
  gatherDeterministicEvidence,
  type DeterministicReviewEvidence,
} from './officeReviewPrompt';

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
    const reviewPrompt = buildReviewPrompt(task, artifact, evidence);
    const promptStamp = stampPrompt(agentPromptRef('office.review'), reviewPrompt);

    let critique: ModelCritique | undefined;
    let measurement: AgentInvocationMeasurement | undefined;
    try {
      const raw = await deps.invokePersona(
        task.assigneeId,
        reviewPrompt,
        project!,
        deps.getProfile?.(task.assigneeId),
      );
      const parsed = parseStructured<ModelCritique>(typeof raw === 'string' ? raw : raw.text);
      if (parsed.ok) critique = parsed.value;
      measurement = measurementOf(raw);
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
    // La crítica cuenta sólo si dio un veredicto que se pueda leer: una llamada
    // fallida, un JSON roto o una respuesta vacía no son una revisión
    // (plan de agentes, 17.1).
    const critiqued = modelVerdict === 'approved' || modelVerdict === 'changes-requested' || modelVerdict === 'rejected';

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
      measurement,
      traceId,
      promptStamp,
      verdict,
      findings,
      deterministicScore: evidence.score,
      blockingValidatorIds: evidence.blockingValidatorIds,
      basis: critiqued ? 'model-and-evidence' : 'evidence-only',
      ...(artifact.content.length > REVIEW_CONTENT_LIMIT ? { truncated: true } : {}),
      summary: !critiqued && verdict === 'approved'
        // Nunca «cumple su contrato» sin que nadie lo haya revisado.
        ? 'La revisión del especialista no llegó: la evidencia determinista no encuentra defectos bloqueantes, pero nadie ha revisado el contenido. Confírmalo antes de seguir.'
        : typeof critique?.summary === 'string' && critique.summary.trim().length > 0
          ? critique.summary
          : verdict === 'approved'
            ? 'El entregable cumple su contrato y los criterios de aceptación.'
            : 'El entregable necesita correcciones antes de avanzar.',
      decidedAt,
    };
  };

// La consolidación del encargo vive en `officeConsolidationPort.ts`.
export { buildConsolidationPrompt, createConsolidatePort } from './officeConsolidationPort';

// ---------------------------------------------------------------------------

export const createOfficeRunnerPorts = (deps: OfficeRunnerAdapterDeps): OfficeRunnerPorts => ({
  produceArtifact: createProduceArtifactPort(deps),
  reviewArtifact: createReviewArtifactPort(deps),
  consolidate: createConsolidatePort(deps),
  persist: deps.persist,
  onProgress: deps.onProgress,
});
