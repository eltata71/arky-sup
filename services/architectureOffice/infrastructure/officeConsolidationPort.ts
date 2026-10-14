/**
 * Puerto de consolidación del encargo: consolida, evalúa sin modelo y corrige
 * una sola vez (plan de agentes, 18.2).
 */
import type { AgentInvocationResult, AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import { newPrefixedId } from '../../../lib/ids';
import { agentPromptRef, stampPrompt } from '../../../lib/agents/promptCatalog';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';
import { buildConsolidationRefinementPrompt, evaluateConsolidation, type OfficeWorkstreamResult } from '../domain/officeConsolidationReview';
import type { OfficeEngagement, OfficeTask } from '../domain/OfficeTypes';
import type { OfficeConsolidateOutcome } from '../application/OfficeEngagementRunner';
import type { OfficeRunnerAdapterDeps } from './OfficeRunnerAdapters';

export const measurementOf = (result: string | AgentInvocationResult): AgentInvocationMeasurement | undefined =>
  typeof result === 'string' ? undefined : {
    aiCalls: result.aiCalls,
    model: result.model,
    usage: result.usage,
    latencyMs: result.latencyMs,
    traceId: result.traceId,
    estimatedCostUsd: result.estimatedCostUsd,
  };

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

export const buildConsolidationPrompt = (engagement: OfficeEngagement): string => {
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

  // La persona del consolidador va en el prompt de sistema (plan de agentes, 16.0).
  return [
    `Consolida el entregable "${engagement.title}".`,
    // El brief es texto de una persona: viaja vallado (plan de agentes, 17.0).
    wrapUntrustedContent('solicitud original', engagement.brief),
    '',
    'ENTREGABLES Y SUS REVISIONES:',
    ...deliverables,
    '',
    'Compara los dominios, resuelve o escala las contradicciones con dueño, y cierra con un veredicto Ready, Conditional o Blocked justificado con evidencia concreta.',
    'No inventes evidencia. Si un entregable falló, dilo y explica la consecuencia.',
  ].join('\n');
};

const engagementContributions = (engagement: OfficeEngagement): OfficeWorkstreamResult[] =>
  engagement.tasks
    .filter((item) => item.kind === 'produce-artifact')
    .map((item) => ({
      workstreamId: item.id,
      personaId: item.assigneeId,
      status: item.status === 'completed' ? 'completed' as const : 'failed' as const,
      output: '',
    }));

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
    const consolidationPrompt = buildConsolidationPrompt(engagement);
    const promptStamp = stampPrompt(agentPromptRef('office.engagement-consolidation'), consolidationPrompt);
    const textOf = (response: string | AgentInvocationResult) => (typeof response === 'string' ? response : response.text).trim();
    const callsOf = (response: string | AgentInvocationResult) => (typeof response === 'string' ? 1 : response.aiCalls ?? 1);
    try {
      const response = await deps.invokePersona(
        task.assigneeId,
        consolidationPrompt,
        project,
        deps.getProfile?.(task.assigneeId),
      );
      let summary = textOf(response) || 'Consolidación sin contenido.';
      let aiCalls = callsOf(response);
      // Mismo evaluador y mismo tope que la coordinación del dock (18.2): una
      // sola corrección, y si falla o viene vacía se conserva el original.
      const contributions = engagementContributions(engagement);
      let review = evaluateConsolidation(summary, contributions);
      let refinement: OfficeConsolidateOutcome['refinement'];
      if (!review.ok) {
        const refinementPrompt = buildConsolidationRefinementPrompt(summary, review);
        const refinementStamp = stampPrompt(agentPromptRef('office.consolidation-refinement'), refinementPrompt);
        const refinementTraceId = newPrefixedId('office-consolidate');
        aiCalls += 1;
        try {
          const corrected = await deps.invokePersona(task.assigneeId, refinementPrompt, project, deps.getProfile?.(task.assigneeId));
          const correctedText = textOf(corrected);
          aiCalls += callsOf(corrected) - 1;
          refinement = { traceId: refinementTraceId, promptStamp: refinementStamp, measurement: measurementOf(corrected) };
          if (correctedText) {
            summary = correctedText;
            review = { ...evaluateConsolidation(summary, contributions) };
            return {
              status: 'success', measurement: measurementOf(response), summary, aiCalls, traceId, promptStamp,
              review: { ok: review.ok, gaps: review.gaps, refined: true }, refinement,
            };
          }
        } catch {
          refinement = { traceId: refinementTraceId, promptStamp: refinementStamp };
        }
        return {
          status: 'success', measurement: measurementOf(response), summary, aiCalls, traceId, promptStamp,
          review: { ok: review.ok, gaps: review.gaps, refined: false }, refinement,
        };
      }
      return {
        status: 'success',
        measurement: measurementOf(response),
        summary,
        aiCalls,
        traceId,
        promptStamp,
        review: { ok: true, gaps: [], refined: false },
      };
    } catch (error) {
      return {
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        aiCalls: 1,
        traceId,
        promptStamp,
      };
    }
  };

