import { newPrefixedId } from '../../../lib/ids';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';
import { foldOfficeText, hasExactOfficeMention } from '../domain/officeShared';
import { rankSpecialistsForRequest } from '../domain/OfficeAgentRouter';
import {
  createHandoff,
  renderHandoffPrompt,
  type HandoffRejection,
} from '../domain/agentHandoff';
import type { AgentHandoffKind } from '../domain/agentDefinition';
import { workstreamCapableAgents } from '../domain/agentRegistry';
import {
  buildConsolidationRefinementPrompt,
  evaluateConsolidation,
  type ConsolidationReview,
} from '../domain/officeConsolidationReview';

export interface OfficeWorkstream {
  id: string;
  /**
   * Who runs the workstream.
   *
   * It was `Exclude<OfficeAgentId, 'arky' | 'lucia' | 'alejandro'>` — three
   * names hand-kept in step with a registry that already declares the same
   * fact as `orchestrationRole` and `capabilities`. The rule now lives in one
   * place (`canTakeWorkstream`) and is checked at runtime, so a persona added
   * without `consult` cannot be handed work by a regex that happens to match.
   */
  personaId: OfficeAgentId;
  objective: string;
  acceptanceCriteria: string[];
}

export interface OfficeOrchestrationPlan {
  operationId: string;
  request: string;
  coordinatorId: 'lucia';
  consolidatorId: 'alejandro';
  workstreams: OfficeWorkstream[];
}

export interface RejectedHandoff {
  sourceAgentId: OfficeAgentId;
  targetAgentId: OfficeAgentId;
  kind: AgentHandoffKind;
  rejections: HandoffRejection[];
}

export interface OfficeWorkstreamResult {
  workstreamId: string;
  personaId: OfficeAgentId;
  status: 'completed' | 'failed';
  output: string;
  error?: string;
}

export interface OfficeOrchestrationResult {
  operationId: string;
  status: 'completed' | 'partial' | 'failed';
  coordination: string;
  workstreamResults: OfficeWorkstreamResult[];
  consolidation: string;
  /**
   * Handoffs the Office refused to issue, with the reason.
   *
   * Reported rather than thrown or swallowed: a workstream whose handoff was
   * rejected is work that did not happen, and a caller presenting the
   * recommendation has a right to know the team was smaller than it looks.
   */
  rejectedHandoffs?: RejectedHandoff[];
  /**
   * Qué dijo el evaluador de la consolidación, y si hubo una pasada de
   * corrección. Se devuelve —en vez de quedarse dentro— porque un consumidor
   * que presenta la recomendación tiene derecho a saber que salió a la segunda,
   * o que salió con huecos reconocidos.
   */
  consolidationReview?: ConsolidationReview;
  refined?: boolean;
}

export interface OfficeOrchestrationOptions {
  maxConcurrency?: number;
  /**
   * Cuántas veces puede el consolidador corregir su recomendación tras la
   * evaluación. Uno por defecto, y uno es el tope razonable: la segunda pasada
   * ya tiene toda la información que va a tener, y un bucle sin límite es la
   * forma cara de no converger.
   */
  maxConsolidationRefinements?: number;
  /** Correlation id of the attempt these handoffs belong to. */
  runId?: string;
}

export type OfficeAgentInvoker = (
  personaId: OfficeAgentId,
  instruction: string,
) => Promise<string>;

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

export interface OfficePlanOptions {
  /**
   * Especialistas que no deben convocarse — normalmente porque el usuario los
   * desactivó en su ficha.
   *
   * Nunca puede dejar el equipo vacío: una solicitud sin ningún especialista
   * produciría una recomendación firmada por nadie, que es peor que una
   * recomendación de un especialista que no era el ideal. Si el filtro se lo
   * lleva todo, el plan cae en el generalista de software y lo dice el propio
   * roster.
   */
  unavailable?: readonly OfficeAgentId[];
  /**
   * Tope de especialistas por operación.
   *
   * Un límite explícito, no un efecto secundario del enrutado: una solicitud
   * que menciona siete dominios convoca a siete agentes, y cada uno es una
   * llamada al proveedor y unos segundos de espera. Anthropic lo dice como
   * condición de parada — un sistema de agentes necesita un límite declarado,
   * no un límite emergente.
   */
  maxSpecialists?: number;
}

/** Cuántos especialistas puede convocar una operación si nadie dice otra cosa. */
export const DEFAULT_MAX_SPECIALISTS = 4;

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
      objective: `Analiza desde ${OFFICE_AGENT_PERSONAS[personaId].role}: ${request}`,
      acceptanceCriteria: criteriaFor(personaId),
    })),
  };
};

export const executeOfficeOrchestration = async (
  plan: OfficeOrchestrationPlan,
  invoke: OfficeAgentInvoker,
  options: OfficeOrchestrationOptions = {},
): Promise<OfficeOrchestrationResult> => {
  const coordinationPrompt = [
    `Coordina la solicitud: ${plan.request}`,
    'Revisa la descomposición determinística propuesta, explica dependencias, orden, riesgos y límites de ejecución.',
    'No inventes evidencia. Devuelve un brief conciso que guíe a los especialistas.',
    ...plan.workstreams.map((workstream) => `- ${OFFICE_AGENT_PERSONAS[workstream.personaId].alias}: ${workstream.objective}`),
  ].join('\n');

  let coordination: string;
  try {
    coordination = await invoke(plan.coordinatorId, coordinationPrompt);
  } catch (error) {
    return {
      operationId: plan.operationId,
      status: 'failed',
      coordination: error instanceof Error ? error.message : String(error),
      workstreamResults: [],
      consolidation: 'La coordinación de Lucía falló; no se ejecutaron especialistas.',
    };
  }

  const rejectedHandoffs: RejectedHandoff[] = [];
  const maxConcurrency = Math.max(1, Math.min(3, options.maxConcurrency ?? 3));
  const workstreamResults: OfficeWorkstreamResult[] = new Array(plan.workstreams.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < plan.workstreams.length) {
      const index = nextIndex;
      nextIndex += 1;
      const workstream = plan.workstreams[index];
      // El encargo viaja como contrato, no como cadena concatenada: quién lo
      // manda, para qué, con qué criterios, qué se espera de vuelta y con qué
      // tope. La cadena es una representación del contrato, no al revés.
      const handoff = createHandoff({
        kind: 'workstream',
        sourceAgentId: plan.coordinatorId,
        targetAgentId: workstream.personaId,
        reason: 'La operación necesita el análisis de este dominio.',
        objective: workstream.objective,
        constraints: [],
        acceptanceCriteria: [...workstream.acceptanceCriteria],
        contextReferences: [{
          kind: 'coordination-brief',
          label: 'Brief de coordinación',
          from: plan.coordinatorId,
          content: coordination,
        }],
        expectedOutput: {
          kind: 'analysis',
          description: 'Un análisis del dominio con supuestos, riesgos y decisiones explícitos.',
        },
        budget: { maxAiCalls: 1 },
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
        const output = await invoke(
          workstream.personaId,
          renderHandoffPrompt(handoff.envelope),
        );
        workstreamResults[index] = {
          workstreamId: workstream.id,
          personaId: workstream.personaId,
          status: 'completed',
          output,
        };
      } catch (error) {
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
    { length: Math.min(maxConcurrency, plan.workstreams.length) },
    () => worker(),
  ));

  // Los resultados llegan al consolidador como referencias atribuidas, no como
  // un bloque concatenado: quién dijo qué, y si su workstream salió o falló.
  const consolidationHandoff = createHandoff({
    kind: 'consolidation',
    sourceAgentId: plan.coordinatorId,
    targetAgentId: plan.consolidatorId,
    reason: `Consolidar la operación ${plan.operationId}.`,
    objective: `Consolida la operación para la solicitud: ${plan.request}`,
    constraints: ['Compara dominios y resuelve contradicciones sin inventar evidencia.'],
    acceptanceCriteria: ['La recomendación es Ready, Conditional o Blocked, y cita a cada contribuyente.'],
    contextReferences: workstreamResults.map((result) => ({
      kind: 'workstream-result' as const,
      label: `Workstream ${result.workstreamId}`,
      from: result.personaId,
      status: result.status,
      content: result.output || `Error: ${result.error ?? 'sin resultado'}`,
    })),
    expectedOutput: {
      kind: 'recommendation',
      description: 'Una recomendación Ready, Conditional o Blocked con su justificación.',
    },
    budget: { maxAiCalls: 1 + Math.max(0, options.maxConsolidationRefinements ?? 1) },
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
    };
  }

  const consolidationPrompt = renderHandoffPrompt(consolidationHandoff.envelope);

  let consolidation: string;
  try {
    consolidation = await invoke(plan.consolidatorId, consolidationPrompt);
  } catch (error) {
    return {
      operationId: plan.operationId,
      status: 'failed',
      coordination,
      workstreamResults,
      consolidation: error instanceof Error ? error.message : String(error),
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
  let review = evaluateConsolidation(consolidation, workstreamResults);
  let refined = false;
  const maxRefinements = Math.max(0, Math.min(1, options.maxConsolidationRefinements ?? 1));
  if (!review.ok && maxRefinements > 0) {
    try {
      const corrected = await invoke(
        plan.consolidatorId,
        buildConsolidationRefinementPrompt(consolidation, review),
      );
      if (corrected.trim().length > 0) {
        consolidation = corrected;
        refined = true;
        review = evaluateConsolidation(consolidation, workstreamResults);
      }
    } catch {
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
    rejectedHandoffs: rejectedHandoffs.length > 0 ? rejectedHandoffs : undefined,
  };
};
