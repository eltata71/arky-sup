/**
 * La persona aprueba el plan del equipo antes de gastar (plan de agentes 20.2).
 *
 * Una solicitud que convoca a varios especialistas es una operación cara: cada
 * uno es una llamada a un modelo, y la coordinadora y la consolidadora suman
 * otras dos. Por debajo del umbral la Oficina trabaja como siempre, sin
 * fricción; por encima, el plan determinista —antes de **cualquier** llamada—
 * se le enseña a la persona, que puede aprobarlo, quitar un especialista o
 * cancelar.
 *
 * Todo aquí es puro. El plan sale de `planOfficeWorkstreams`, que no llama a
 * ningún modelo: por eso se puede enseñar *antes* de gastar nada, y por eso
 * «cancelar» no deja estado a medias: no había empezado nada.
 */

import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import type { OfficeOrchestrationPlan } from './officeOrchestrationTypes';

/**
 * Con cuatro especialistas —el máximo que convoca una solicitud— la operación
 * pide aprobación. Medido el 2026-10-23: una petición vaga ya convoca tres
 * (Gabriel, Elena, Tomás) y preguntar en cada una sería fricción sin criterio;
 * el tope de cuatro es el caso que de verdad abarca varios dominios.
 */
export const APPROVAL_SPECIALIST_THRESHOLD = 4;

export interface PlanApprovalProposal {
  operationId: string;
  request: string;
  coordinatorId: OfficeAgentId;
  consolidatorId: OfficeAgentId;
  specialists: { personaId: OfficeAgentId; objective: string; acceptanceCriteria: string[] }[];
  /**
   * Cota de llamadas al modelo: la coordinadora, un análisis por especialista,
   * la consolidación y la única corrección posible. Es un tope, no una
   * previsión; el coste real se mide al terminar y nunca se estima aquí con un
   * número que parezca medido.
   */
  maxModelCalls: number;
}

export type PlanApprovalDecision =
  | { decision: 'approve'; removeSpecialists?: readonly OfficeAgentId[] }
  | { decision: 'cancel' };

export type PlanApprovalPort = (proposal: PlanApprovalProposal) => Promise<PlanApprovalDecision>;

export const requiresPlanApproval = (
  plan: Pick<OfficeOrchestrationPlan, 'workstreams'>,
  threshold: number = APPROVAL_SPECIALIST_THRESHOLD,
): boolean => plan.workstreams.length >= threshold;

export const proposeFromPlan = (plan: OfficeOrchestrationPlan): PlanApprovalProposal => ({
  operationId: plan.operationId,
  request: plan.request,
  coordinatorId: plan.coordinatorId,
  consolidatorId: plan.consolidatorId,
  specialists: plan.workstreams.map((workstream) => ({
    personaId: workstream.personaId as OfficeAgentId,
    objective: workstream.objective,
    acceptanceCriteria: [...workstream.acceptanceCriteria],
  })),
  maxModelCalls: 1 + plan.workstreams.length + 1 + 1,
});

export type ApprovalApplication =
  | { outcome: 'cancelled' }
  | { outcome: 'approved'; plan: OfficeOrchestrationPlan; removed: OfficeAgentId[] };

/**
 * Aplica la decisión al plan.
 *
 * Sólo se quita a quien está en el plan, y nunca a todos: un equipo sin
 * especialistas produciría una recomendación firmada por nadie. Si la petición
 * los quitara a todos, se conserva el plan entero y se dice que no se aplicó.
 */
export const applyApprovalDecision = (
  plan: OfficeOrchestrationPlan,
  decision: PlanApprovalDecision,
): ApprovalApplication => {
  if (decision.decision === 'cancel') return { outcome: 'cancelled' };
  const requested = new Set(decision.removeSpecialists ?? []);
  const kept = plan.workstreams.filter((workstream) => !requested.has(workstream.personaId as OfficeAgentId));
  if (kept.length === 0 || kept.length === plan.workstreams.length) {
    return { outcome: 'approved', plan, removed: [] };
  }
  const removed = plan.workstreams
    .filter((workstream) => requested.has(workstream.personaId as OfficeAgentId))
    .map((workstream) => workstream.personaId as OfficeAgentId);
  return { outcome: 'approved', plan: { ...plan, workstreams: kept }, removed };
};
