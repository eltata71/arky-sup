import { newPrefixedId } from '../../../lib/ids';
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
// Boot/route code: parseStructured enters by its small door, not the services/ai barrel (the barrel drags the whole AI layer into every route that imports the Office).
import { parseStructured } from '../../ai/structuredOutput';
import {
  applyCoordinationBrief, evaluateRecommendationFields, readCoordinationBrief, readRecommendation, readSpecialistAnalysis,
  renderCoordinationBrief, renderRecommendation, renderSpecialistAnalysis,
  type ContractReading, type SpecialistAnalysis,
} from '../domain/orchestrationContracts';
import { COORDINATION_BRIEF_SCHEMA, RECOMMENDATION_SCHEMA, SPECIALIST_ANALYSIS_SCHEMA } from './orchestrationSchemas';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';
import { foldOfficeText, hasExactOfficeMention } from '../domain/officeShared';
import { rankSpecialistsForRequest } from '../domain/OfficeAgentRouter';
import { applyContextPolicy, compactAnalysisForConsolidator } from '../domain/agentContextPolicy';
import { createHandoff, renderHandoffPrompt, DEFAULT_MAX_SPECIALISTS } from '../domain/agentHandoff';
import type { AgentHandoffKind } from '../domain/agentDefinition';
import { workstreamCapableAgents } from '../domain/agentRegistry';
import { HandoffBudgetExhausted, withHandoffBudget } from './handoffBudget';

import {
  buildConsolidationRefinementPrompt,
  evaluateConsolidation,
  type ConsolidationReview,
  type OfficeWorkstreamResult,
} from '../domain/officeConsolidationReview';

export * from './officeOrchestrationTypes';
import type {
  OfficeAgentInvoker, OfficeOrchestrationOptions, OfficeOrchestrationPlan, OfficeOrchestrationResult, OfficePlanOptions, RejectedHandoff,
} from './officeOrchestrationTypes';


export const isOfficeOrchestrationRequest = (request: string): boolean => {
  const normalized = foldOfficeText(request);
  const addressesLucia = hasExactOfficeMention(request, 'Lucía');
  return addressesLucia && /\b(coordina|orquesta|ejecuta|lanza)\b/.test(normalized);
};

const criteriaFor = (personaId: OfficeAgentId): string[] => {
  const persona = OFFICE_AGENT_PERSONAS[personaId];
  return [
    `Resultado alineado con el rol ${persona.role}.`,
    'Supuestos, riesgos y decisiones quedan explícitos.',
    'Toda afirmación de calidad se acompaña de evidencia o se marca como pendiente.',
  ];
};

/** Cuántos especialistas puede convocar una operación si nadie dice otra cosa. */
export { DEFAULT_MAX_SPECIALISTS };

export const planOfficeWorkstreams = (
  request: string,
  options: OfficePlanOptions = {},
): OfficeOrchestrationPlan => {
  const unavailable = new Set<OfficeAgentId>(options.unavailable ?? []);
  // Una sola tabla de enrutado, la del router. La copia que vivía aquí había
  // divergido: no tenía la supresión de falsos positivos, así que «Health
  // Cloud» convocaba al arquitecto de AWS por este camino y no por el otro.
  const selected = rankSpecialistsForRequest(request)
    .filter((personaId) => !unavailable.has(personaId));

  if (selected.length === 0) {
    for (const fallback of ['gabriel', 'elena', 'tomas'] as OfficeAgentId[]) {
      if (!unavailable.has(fallback)) selected.push(fallback);
    }
  }
  if (selected.length === 0) {
    // Antes de rendirse: cualquier especialista habilitado sirve mejor que uno
    // apagado. La lista de reserva son tres nombres, y apagar esos tres no
    // puede obligar a la Oficina a convocar justo a alguien que el usuario
    // desactivó teniendo a otros disponibles.
    for (const persona of workstreamCapableAgents()) {
      if (!unavailable.has(persona.id)) {
        selected.push(persona.id);
        break;
      }
    }
  }
  // El último recurso: un equipo sin nadie no es un equipo pequeño, es una
  // operación que no puede responder. Sólo se llega aquí con *todos* los
  // especialistas desactivados.
  if (selected.length === 0) selected.push('gabriel');
  const limit = Math.max(1, options.maxSpecialists ?? DEFAULT_MAX_SPECIALISTS);
  const unique = Array.from(new Set(selected)).slice(0, limit);
  return {
    operationId: newPrefixedId('office'),
    request,
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    workstreams: unique.map((personaId, index) => ({
      id: `ws-${index + 1}-${personaId}`,
      personaId,
      // La solicitud no va en el objetivo: es texto de una persona y viaja
      // vallada como referencia del handoff (plan de agentes, 17.0).
      objective: `Analiza la solicitud desde tu dominio (${OFFICE_AGENT_PERSONAS[personaId].role}).`,
      acceptanceCriteria: criteriaFor(personaId),
    })),
  };
};

/** Lo que se le pide a la coordinadora. Plantilla `office.coordination`. */
export const buildCoordinationPrompt = (plan: Pick<OfficeOrchestrationPlan, 'request' | 'workstreams'>): string => [
  'Coordina la solicitud que sigue.',
  // Lo que escribió la persona viaja vallado: es material a coordinar, no
  // órdenes para la coordinadora (plan de agentes, 17.0).
  wrapUntrustedContent('solicitud', plan.request),
  'Revisa la descomposición determinística propuesta, explica dependencias, orden, riesgos y límites de ejecución.',
  'No inventes evidencia. Devuelve un brief conciso que guíe a los especialistas.',
  'Responde sólo con JSON: summary, order, dependencies, dropWorkstreams (especialistas que no hacen falta; nunca todos) y extraConstraints.',
  ...plan.workstreams.map((workstream) => `- ${OFFICE_AGENT_PERSONAS[workstream.personaId].alias}: ${workstream.objective}`),
].join('\n');

export const executeOfficeOrchestration = async (
  plan: OfficeOrchestrationPlan,
  invoke: OfficeAgentInvoker,
  options: OfficeOrchestrationOptions = {},
): Promise<OfficeOrchestrationResult> => {
  // Cada invocación sale con el sello de su plantilla y queda en el resultado,
  // en orden: es lo que permite comparar dos respuestas y saber si cambió la
  // plantilla o sólo el modelo.
  const maxRefinements = Math.max(0, Math.min(1, options.maxConsolidationRefinements ?? 1));
  const operationInvoke = withHandoffBudget(invoke, {
    budget: {
      maxAiCalls: options.maxAiCalls ?? 1 + plan.workstreams.length + 1 + maxRefinements,
      maxTokens: options.maxTokens ?? 100_000,
    },
  });
  // Accounting is execution-only: route imports must not download its runtime.
  const { createOfficeInvocationRecorder } = await import('./officeInvocationRecorder');
  const { promptStamps, invocations, usage, invokeStamped } = createOfficeInvocationRecorder(plan, operationInvoke, options);
  const structuredDegraded: string[] = [];
  const readContract = <T,>(label: string, raw: string, reader: (value: unknown) => ContractReading<T>): T | null => {
    const parsed = parseStructured<unknown>(raw);
    if (!parsed.ok) { structuredDegraded.push(`${label}: la respuesta no era JSON; se conserva el texto.`); return null; }
    const reading = reader(parsed.value);
    for (const note of reading.discarded) structuredDegraded.push(`${label}: ${note}`);
    if (reading.value === null) structuredDegraded.push(`${label}: no cumple el contrato; se conserva el texto.`);
    return reading.value;
  };
  const coordinationPrompt = buildCoordinationPrompt(plan);

  let coordination: string;
  try {
    coordination = await invokeStamped(plan.coordinatorId, coordinationPrompt, 'office.coordination', undefined, COORDINATION_BRIEF_SCHEMA);
  } catch (error) {
    return {
      operationId: plan.operationId,
      status: 'failed',
      coordination: error instanceof Error ? error.message : String(error),
      workstreamResults: [],
      consolidation: 'La coordinación de Lucía falló; no se ejecutaron especialistas.',
      promptStamps, invocations,
      usage: usage(),
    };
  }

  const coordinationBrief = readContract('Coordinación', coordination, readCoordinationBrief);
  if (coordinationBrief) coordination = renderCoordinationBrief(coordinationBrief);
  const briefApplication = applyCoordinationBrief(coordinationBrief, plan.workstreams);
  const activeWorkstreams = plan.workstreams.filter((w) => briefApplication.keep.includes(w.id));
  const analyses: Partial<Record<string, SpecialistAnalysis>> = {};

  const rejectedHandoffs: RejectedHandoff[] = [];
  const recordBudgetRejection = (sourceAgentId: OfficeAgentId, targetAgentId: OfficeAgentId, kind: AgentHandoffKind, error: unknown): void => {
    if (error instanceof HandoffBudgetExhausted) rejectedHandoffs.push({
      sourceAgentId, targetAgentId, kind, rejections: [error.rejection],
    });
  };
  const maxConcurrency = Math.max(1, Math.min(3, options.maxConcurrency ?? 3));
  const workstreamResults: OfficeWorkstreamResult[] = new Array(activeWorkstreams.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < activeWorkstreams.length && !options.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const workstream = activeWorkstreams[index];
      // El encargo viaja como contrato, no como cadena concatenada: quién lo
      // manda, para qué, con qué criterios, qué se espera de vuelta y con qué
      // tope. La cadena es una representación del contrato, no al revés.
      const specialistContext = applyContextPolicy('specialist', [
        { kind: 'record', label: 'Solicitud', content: plan.request },
        { kind: 'coordination-brief', label: 'Brief de coordinación', from: plan.coordinatorId, content: coordination },
      ]);
      const handoff = createHandoff({
        kind: 'workstream',
        sourceAgentId: plan.coordinatorId,
        targetAgentId: workstream.personaId,
        reason: 'La operación necesita el análisis de este dominio.',
        objective: workstream.objective,
        constraints: [...briefApplication.extraConstraints],
        acceptanceCriteria: [...workstream.acceptanceCriteria],
        contextReferences: specialistContext.references,
        expectedOutput: {
          kind: 'analysis',
          description: 'Un análisis del dominio con supuestos, riesgos y decisiones explícitos, como JSON (summary, findings, assumptions, risks, decisions, outOfScope, evidence, confidence).',
        },
        budget: { maxAiCalls: 1, maxTokens: 30_000 },
        runId: options.runId,
      });

      if (handoff.outcome === 'rejected') {
        rejectedHandoffs.push({
          sourceAgentId: plan.coordinatorId,
          targetAgentId: workstream.personaId,
          kind: 'workstream',
          rejections: handoff.rejections,
        });
        workstreamResults[index] = {
          workstreamId: workstream.id,
          personaId: workstream.personaId,
          status: 'failed',
          output: '',
          error: handoff.rejections.map((rejection) => rejection.message).join(' '),
        };
        continue;
      }

      try {
        const rawOutput = await invokeStamped(
          workstream.personaId,
          renderHandoffPrompt(handoff.envelope),
          'office.workstream',
          withHandoffBudget(operationInvoke, handoff.envelope),
          SPECIALIST_ANALYSIS_SCHEMA,
          handoff.envelope.handoffId,
          workstream.id,
          specialistContext.manifest,
        );
        const analysis = readContract(`Análisis de ${OFFICE_AGENT_PERSONAS[workstream.personaId].alias}`, rawOutput, readSpecialistAnalysis);
        if (analysis) analyses[workstream.id] = analysis;
        const output = analysis ? renderSpecialistAnalysis(analysis) : rawOutput;
        workstreamResults[index] = {
          workstreamId: workstream.id,
          personaId: workstream.personaId,
          status: 'completed',
          output,
        };
      } catch (error) {
        recordBudgetRejection(plan.coordinatorId, workstream.personaId, 'workstream', error);
        workstreamResults[index] = {
          workstreamId: workstream.id,
          personaId: workstream.personaId,
          status: 'failed',
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(maxConcurrency, activeWorkstreams.length) },
    () => worker(),
  ));

  if (options.signal?.aborted) return {
    operationId: plan.operationId, status: 'failed', coordination, workstreamResults: workstreamResults.filter(Boolean),
    consolidation: 'Operación cancelada por la persona.', rejectedHandoffs, promptStamps, invocations, usage: usage(),
  };

  // Los resultados llegan al consolidador como referencias atribuidas, no como
  // un bloque concatenado: quién dijo qué, y si su workstream salió o falló.
  // El consolidador lee el análisis estructurado compacto, nunca el texto
  // completo de cada especialista (plan de agentes, 19.1): el detalle sigue en
  // el resultado del workstream para quien lo abra.
  const consolidatorContext = applyContextPolicy('consolidator', workstreamResults.map((result) => {
    const analysis = analyses[result.workstreamId];
    return {
      kind: 'workstream-result' as const,
      label: `Workstream ${result.workstreamId}`,
      from: result.personaId,
      status: result.status,
      content: result.output ? (analysis ? compactAnalysisForConsolidator(analysis) : result.output) : `Error: ${result.error ?? 'sin resultado'}`,
    };
  }));
  const consolidationHandoff = createHandoff({
    kind: 'consolidation',
    sourceAgentId: plan.coordinatorId,
    targetAgentId: plan.consolidatorId,
    reason: `Consolidar la operación ${plan.operationId}.`,
    objective: `Consolida la operación para la solicitud: ${plan.request}`,
    constraints: ['Compara dominios y resuelve contradicciones sin inventar evidencia.'],
    acceptanceCriteria: ['La recomendación es Ready, Conditional o Blocked, y cita a cada contribuyente.'],
    contextReferences: consolidatorContext.references,
    expectedOutput: {
      kind: 'recommendation',
      description: 'Una recomendación como JSON: verdict (ready|conditional|blocked), rationale, contributions por especialista, contradictions con owner, conditions y openQuestions.',
    },
    budget: { maxAiCalls: 1 + maxRefinements, maxTokens: 40_000 },
    runId: options.runId,
  });

  if (consolidationHandoff.outcome === 'rejected') {
    rejectedHandoffs.push({
      sourceAgentId: plan.coordinatorId,
      targetAgentId: plan.consolidatorId,
      kind: 'consolidation',
      rejections: consolidationHandoff.rejections,
    });
    return {
      operationId: plan.operationId,
      status: 'failed',
      coordination,
      workstreamResults,
      consolidation: consolidationHandoff.rejections.map((r) => r.message).join(' '),
      rejectedHandoffs,
      promptStamps, invocations,
      usage: usage(),
    };
  }

  const consolidationPrompt = renderHandoffPrompt(consolidationHandoff.envelope);
  const consolidationInvoke = withHandoffBudget(operationInvoke, consolidationHandoff.envelope);

  let consolidation: string;
  try {
    consolidation = await invokeStamped(plan.consolidatorId, consolidationPrompt, 'office.consolidation', consolidationInvoke, RECOMMENDATION_SCHEMA, consolidationHandoff.envelope.handoffId, undefined, consolidatorContext.manifest);
  } catch (error) {
    recordBudgetRejection(plan.coordinatorId, plan.consolidatorId, 'consolidation', error);
    return {
      operationId: plan.operationId,
      status: 'failed',
      coordination,
      workstreamResults,
      consolidation: error instanceof Error ? error.message : String(error),
      rejectedHandoffs: rejectedHandoffs.length > 0 ? rejectedHandoffs : undefined,
      promptStamps, invocations,
      usage: usage(),
    };
  }

  /*
   * Evaluador-optimizador, acotado.
   *
   * La evaluación es determinista y gratis; la corrección cuesta una llamada y
   * sólo se paga cuando la evaluación encuentra algo. Si la corrección falla,
   * se conserva la consolidación original: una recomendación imperfecta vale
   * más que un error donde debería estar la respuesta.
   */
  let recommendation = readContract('Recomendación', consolidation, readRecommendation);
  if (recommendation) consolidation = renderRecommendation(recommendation);
  const evaluate = (): ConsolidationReview => {
    if (!recommendation) return evaluateConsolidation(consolidation, workstreamResults);
    const gaps = evaluateRecommendationFields(recommendation, workstreamResults);
    return { ok: gaps.length === 0, gaps };
  };
  let review = evaluate();
  let refined = false;
  if (!review.ok && maxRefinements > 0) {
    try {
      const corrected = await invokeStamped(
        plan.consolidatorId,
        buildConsolidationRefinementPrompt(consolidation, review),
        'office.consolidation-refinement',
        consolidationInvoke,
        RECOMMENDATION_SCHEMA,
        consolidationHandoff.envelope.handoffId,
      );
      if (corrected.trim().length > 0) {
        const correctedRecommendation = readContract('Recomendación corregida', corrected, readRecommendation);
        recommendation = correctedRecommendation;
        consolidation = correctedRecommendation ? renderRecommendation(correctedRecommendation) : corrected;
        refined = true;
        review = evaluate();
      }
    } catch (error) {
      recordBudgetRejection(plan.coordinatorId, plan.consolidatorId, 'consolidation', error);
      /* se conserva la consolidación original y su evaluación */
    }
  }

  return {
    operationId: plan.operationId,
    status: workstreamResults.some((result) => result.status === 'failed') ? 'partial' : 'completed',
    coordination,
    workstreamResults,
    consolidation,
    consolidationReview: review,
    refined,
    ...(coordinationBrief ? { coordinationBrief } : {}),
    ...(Object.keys(analyses).length > 0 ? { analyses } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(briefApplication.dropped.length > 0 ? { droppedWorkstreams: briefApplication.dropped } : {}),
    ...(structuredDegraded.length > 0 ? { structuredDegraded } : {}),
    rejectedHandoffs: rejectedHandoffs.length > 0 ? rejectedHandoffs : undefined,
    promptStamps, invocations,
    usage: usage(),
  };
};
