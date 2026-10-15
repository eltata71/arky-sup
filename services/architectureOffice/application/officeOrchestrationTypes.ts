import type { AIJsonSchema } from '../../ai';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import type { AgentHandoffKind } from '../domain/agentDefinition';
import type { HandoffRejection } from '../domain/agentHandoff';
import type { AgentInvocationResult, AgentUsageSummary } from '../../../lib/ai/agentUsage';
import type { ConsolidationReview, OfficeWorkstreamResult } from '../domain/officeConsolidationReview';
import type { CoordinationBrief, Recommendation, SpecialistAnalysis } from '../domain/orchestrationContracts';

export type { OfficeWorkstreamResult } from '../domain/officeConsolidationReview';

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
   * El sello de cada invocación, en el orden en que se hicieron
   * (`office.workstream@v1#…`): qué plantilla, en qué versión, y qué texto
   * exacto llegó al modelo (plan de agentes, 15.1).
   */
  promptStamps?: string[];
  /**
   * Qué dijo el evaluador de la consolidación, y si hubo una pasada de
   * corrección. Se devuelve —en vez de quedarse dentro— porque un consumidor
   * que presenta la recomendación tiene derecho a saber que salió a la segunda,
   * o que salió con huecos reconocidos.
   */
  consolidationReview?: ConsolidationReview;
  refined?: boolean;
  /**
   * 18.0: lo que el modelo devolvió como datos. Cuando una respuesta no se pudo
   * leer, el texto crudo sigue en `coordination` / `output` / `consolidation` y
   * el motivo queda en `structuredDegraded`: degradar sin decirlo es el defecto.
   */
  coordinationBrief?: CoordinationBrief;
  analyses?: Partial<Record<string, SpecialistAnalysis>>;
  recommendation?: Recommendation;
  droppedWorkstreams?: string[];
  structuredDegraded?: string[];
  usage: { total: AgentUsageSummary; byAgent: Partial<Record<OfficeAgentId, AgentUsageSummary>> };
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
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAiCalls?: number;
  maxTokens?: number;
}

export interface OfficeAgentCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 18.0: la forma JSON que se le pide al modelo en este traspaso. */
  responseSchema?: AIJsonSchema;
}

export type OfficeAgentInvoker = (
  personaId: OfficeAgentId,
  instruction: string,
  /**
   * El sello de la plantilla que compuso `instruction` (`lib/agents/promptCatalog`).
   * Opcional para el invocador: lo lee quien registra la invocación.
   */
  promptStamp?: string,
  callOptions?: OfficeAgentCallOptions,
) => Promise<string | AgentInvocationResult>;

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
