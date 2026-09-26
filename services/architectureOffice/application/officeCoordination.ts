/**
 * The Office answers as a team, and this module is what makes that literal.
 *
 * `officeOrchestration` already knew how to split a request across specialists
 * and consolidate their answers, but it was opt-in — it only ran when the user
 * explicitly wrote "Lucía, coordina…". Everything else fell through to a single
 * generalist reply. That inverted the product's premise: the assistant is the
 * *entry point to an architecture office*, not an architect that occasionally
 * asks for help.
 *
 * Two things are added here, and nothing that already worked is re-implemented:
 *
 * 1. **The team is the default.** `coordinateRequest` always routes through the
 *    coordinator, the specialists and the consolidator. The team can be *small*
 *    — a question about one domain draws one specialist — but there is always a
 *    coordinator framing it and a consolidator signing it.
 *
 * 2. **The coordination is observable.** Every hand-off emits an event naming
 *    who spoke, to whom, in which phase and why. The UI renders that stream as
 *    it happens, so a user watching the panel sees the office working rather
 *    than a spinner. The events are also the audit trail of an answer that had
 *    several authors.
 *
 * The events are emitted by the coordination itself, never reconstructed
 * afterwards from the result: a panel that animates a plausible-looking
 * sequence rather than the real one is a lie told with motion.
 */

import { newPrefixedId } from '../../../lib/ids';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';
import {
  executeOfficeOrchestration,
  planOfficeWorkstreams,
  type OfficeAgentInvoker,
  type OfficeOrchestrationPlan,
  type OfficeOrchestrationResult,
} from './officeOrchestration';

// ---------------------------------------------------------------------------
// The level the request was made from
// ---------------------------------------------------------------------------

/**
 * Where the user is standing when they ask. The team needs this: the same
 * sentence means different work at different levels of the hierarchy, and an
 * answer framed at the wrong level is worse than no answer.
 */
export type CoordinationScopeLevel = 'initiative' | 'project' | 'deliverable';

export interface CoordinationScope {
  level: CoordinationScopeLevel;
  /** Id of the record in focus, so the answer can be attributed to it. */
  id: string;
  /** Its human name, quoted back to the user in the coordination brief. */
  name: string;
  /**
   * What the team must know about this record to answer well: the initiative's
   * need and driver, the project's description and context, the deliverable's
   * brief and charter. Assembled by the caller, which is the layer that has it.
   */
  briefing: string[];
  /**
   * The levels above, outermost first. An architecture project asked about in
   * isolation loses the business reason it exists for — which is exactly the
   * failure the hierarchy was introduced to prevent.
   */
  ancestry?: { level: CoordinationScopeLevel; name: string; summary: string }[];
}

const LEVEL_FRAMING: Readonly<Record<CoordinationScopeLevel, string>> = Object.freeze({
  initiative: 'una iniciativa de negocio (capa de motivación: necesidad, driver, objetivos, resultados e indicadores)',
  project: 'un proyecto de arquitectura (la respuesta de arquitectura a una iniciativa de negocio)',
  deliverable: 'una solicitud de entregable (una unidad de trabajo gobernada, con responsable, revisor y quality gates)',
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type CoordinationPhase =
  /** The coordinator is reading the request and framing the work. */
  | 'framing'
  /** Work has been handed to the specialists. */
  | 'delegating'
  /** Specialists are working in parallel. */
  | 'working'
  /** Specialists have reported back. */
  | 'reporting'
  /** The consolidator is merging the answers into one recommendation. */
  | 'consolidating'
  /** The operation reached a terminal state. */
  | 'closed';

export type CoordinationEventKind =
  | 'request-received'
  | 'team-assembled'
  | 'assignment'
  | 'agent-started'
  | 'agent-reported'
  | 'agent-failed'
  | 'handoff'
  | 'recommendation'
  | 'operation-failed';

/**
 * One hand-off in the conversation between agents.
 *
 * `from`/`to` are what the animation draws as an edge; `phase` is what it uses
 * to colour the stage; `summary` is what the reader sees in the log. `detail`
 * carries the full text when there is one, so a curious user can open it
 * without the log becoming a wall.
 */
export interface CoordinationEvent {
  id: string;
  kind: CoordinationEventKind;
  phase: CoordinationPhase;
  /** `null` when the message comes from the user rather than an agent. */
  from: OfficeAgentId | null;
  /** `null` when the message is addressed to the user. */
  to: OfficeAgentId | null;
  /** One line, in Spanish, saying what just happened. */
  summary: string;
  detail?: string;
  /** ms since the operation started — drives the timeline, not wall-clock time. */
  elapsedMs: number;
}

export type CoordinationListener = (event: CoordinationEvent) => void;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface CoordinationTeamMember {
  personaId: OfficeAgentId;
  role: 'coordinator' | 'specialist' | 'consolidator';
  /** Why this persona is on the team, in one sentence. */
  rationale: string;
}

export interface CoordinationOutcome {
  operationId: string;
  status: 'completed' | 'partial' | 'failed';
  team: CoordinationTeamMember[];
  /** The consolidator's answer — what the user reads as *the* reply. */
  answer: string;
  /** The coordinator's framing, kept so the reader can see the reasoning. */
  framing: string;
  /** Per-specialist contributions, in the order they were assigned. */
  contributions: { personaId: OfficeAgentId; status: 'completed' | 'failed'; output: string }[];
  events: CoordinationEvent[];
}

export interface CoordinateRequestInput {
  request: string;
  scope: CoordinationScope;
  invoke: OfficeAgentInvoker;
  onEvent?: CoordinationListener;
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number;
  maxConcurrency?: number;
  /**
   * Agents the user has switched off in their card. The office does not
   * convene them; the plan guarantees the team is never left empty.
   */
  unavailableAgents?: readonly OfficeAgentId[];
  /** Stopping condition: how many specialists one request may convene. */
  maxSpecialists?: number;
  /**
   * The configured voice of each agent whose card the user edited, keyed by
   * agent. Prepended to that agent's prompt so a customisation reaches every
   * place the agent speaks — a card that changed nothing about the answers
   * would be decoration.
   *
   * Only customised agents appear here: the rest already receive their
   * shipped instruction through the engine's own persona composer, and saying
   * it twice teaches the model that repetition is the signal.
   */
  agentBriefings?: Partial<Record<OfficeAgentId, string[]>>;
}

/**
 * Builds the team roster from the deterministic plan. The coordinator and the
 * consolidator are structural — every operation has exactly one of each, and
 * they are never the same persona, for the same separation-of-duties reason the
 * engagement runner enforces between a producer and its reviewer.
 */
export const teamFromPlan = (plan: OfficeOrchestrationPlan): CoordinationTeamMember[] => [
  {
    personaId: plan.coordinatorId,
    role: 'coordinator',
    rationale: 'Recibe la solicitud, la descompone y reparte el trabajo entre los especialistas.',
  },
  ...plan.workstreams.map((workstream) => ({
    personaId: workstream.personaId as OfficeAgentId,
    role: 'specialist' as const,
    rationale: `${OFFICE_AGENT_PERSONAS[workstream.personaId].role} — la solicitud toca su dominio.`,
  })),
  {
    personaId: plan.consolidatorId,
    role: 'consolidator',
    rationale: 'Compara los dominios, resuelve contradicciones y firma la recomendación.',
  },
];

/**
 * The context block every agent receives. Written once, here, so a specialist
 * and the consolidator can never be working from different pictures of the
 * record — the drift that makes a multi-agent answer contradict itself.
 */
export const buildScopeBriefing = (scope: CoordinationScope): string => {
  const lines = [
    `Contexto: la solicitud se hace desde ${LEVEL_FRAMING[scope.level]}.`,
    `${scope.level === 'initiative' ? 'Iniciativa' : scope.level === 'project' ? 'Proyecto' : 'Entregable'}: ${scope.name}`,
  ];
  for (const ancestor of scope.ancestry ?? []) {
    lines.push(`  ↑ ${ancestor.level === 'initiative' ? 'Iniciativa de negocio' : 'Proyecto de arquitectura'}: ${ancestor.name}${ancestor.summary ? ` — ${ancestor.summary}` : ''}`);
  }
  for (const line of scope.briefing) {
    if (line.trim().length > 0) lines.push(`  · ${line.trim()}`);
  }
  lines.push('Responde dentro de ese contexto. Si la solicitud no encaja en este nivel, dilo explícitamente en vez de responder en otro.');
  return lines.join('\n');
};

/**
 * Runs a request through the office as a team, emitting the coordination as it
 * happens.
 *
 * The invoker is wrapped rather than the orchestration rewritten: every prompt
 * that reaches a persona goes through here, so the scope briefing is attached
 * exactly once and the start/report events bracket the real call — they cannot
 * drift out of sync with what actually ran.
 */
export const coordinateRequest = async (
  input: CoordinateRequestInput,
): Promise<CoordinationOutcome> => {
  const { request, scope, invoke, onEvent, now = Date.now, maxConcurrency } = input;
  const startedAt = now();
  const events: CoordinationEvent[] = [];

  const emit = (
    kind: CoordinationEventKind,
    phase: CoordinationPhase,
    from: OfficeAgentId | null,
    to: OfficeAgentId | null,
    summary: string,
    detail?: string,
  ): void => {
    const event: CoordinationEvent = {
      id: newPrefixedId('coord'),
      kind,
      phase,
      from,
      to,
      summary,
      detail,
      elapsedMs: Math.max(0, now() - startedAt),
    };
    events.push(event);
    // A listener that throws must not take the operation down with it: the
    // panel is an observer of the work, never a participant in it.
    try {
      onEvent?.(event);
    } catch {
      /* the UI's problem, not the office's */
    }
  };

  const plan = planOfficeWorkstreams(request, {
    unavailable: input.unavailableAgents,
    maxSpecialists: input.maxSpecialists,
  });
  const team = teamFromPlan(plan);
  const briefing = buildScopeBriefing(scope);

  emit('request-received', 'framing', null, plan.coordinatorId,
    `${OFFICE_AGENT_PERSONAS[plan.coordinatorId].alias} recibe la solicitud desde ${scope.name}.`,
    request);

  emit('team-assembled', 'framing', plan.coordinatorId, null,
    `Equipo convocado: ${team.filter((member) => member.role === 'specialist').length} especialista(s), coordina ${OFFICE_AGENT_PERSONAS[plan.coordinatorId].alias}, consolida ${OFFICE_AGENT_PERSONAS[plan.consolidatorId].alias}.`);

  for (const workstream of plan.workstreams) {
    emit('assignment', 'delegating', plan.coordinatorId, workstream.personaId,
      `${OFFICE_AGENT_PERSONAS[workstream.personaId].alias} recibe: ${OFFICE_AGENT_PERSONAS[workstream.personaId].domains[0]}.`,
      workstream.objective);
  }

  /**
   * Wraps the caller's invoker so each persona call is bracketed by its own
   * events and every prompt carries the scope briefing.
   */
  /*
   * Cuántas veces ha hablado ya el consolidador. La segunda vez no es otra
   * recomendación: es la corrección del ciclo evaluador-optimizador, y el panel
   * tiene que poder distinguirlas — un usuario que ve dos «recomendación
   * firmada» seguidas no sabe cuál lee.
   */
  let consolidatorTurns = 0;

  const observedInvoke: OfficeAgentInvoker = async (personaId, instruction) => {
    const isCoordinator = personaId === plan.coordinatorId;
    const isConsolidator = personaId === plan.consolidatorId && !isCoordinator;
    if (isConsolidator) consolidatorTurns += 1;
    const isRefinement = isConsolidator && consolidatorTurns > 1;
    if (isRefinement) {
      emit('handoff', 'consolidating', personaId, null,
        `${OFFICE_AGENT_PERSONAS[personaId].alias} corrige su recomendación contra los criterios de la Oficina.`);
    }
    const phase: CoordinationPhase = isCoordinator
      ? 'framing'
      : isConsolidator ? 'consolidating' : 'working';

    if (!isCoordinator) {
      emit('agent-started', phase, personaId, null,
        `${OFFICE_AGENT_PERSONAS[personaId].alias} está trabajando.`);
    }

    try {
      const configuredVoice = input.agentBriefings?.[personaId];
      const output = await invoke(
        personaId,
        [...(configuredVoice ?? []), briefing, instruction].join('\n\n'),
      );
      emit(
        isConsolidator ? 'recommendation' : 'agent-reported',
        isConsolidator ? 'consolidating' : isCoordinator ? 'delegating' : 'reporting',
        personaId,
        isCoordinator ? null : isConsolidator ? null : plan.consolidatorId,
        isCoordinator
          ? `${OFFICE_AGENT_PERSONAS[personaId].alias} encuadra el trabajo y reparte.`
          : isConsolidator
            ? `${OFFICE_AGENT_PERSONAS[personaId].alias} firma la recomendación.`
            : `${OFFICE_AGENT_PERSONAS[personaId].alias} entrega su análisis.`,
        output,
      );
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit('agent-failed', phase, personaId, null,
        `${OFFICE_AGENT_PERSONAS[personaId].alias} no pudo completar su parte.`, message);
      throw error;
    }
  };

  let result: OfficeOrchestrationResult;
  try {
    result = await executeOfficeOrchestration(plan, observedInvoke, { maxConcurrency });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit('operation-failed', 'closed', null, null, 'La operación de la Oficina se detuvo.', message);
    return {
      operationId: plan.operationId,
      status: 'failed',
      team,
      answer: '',
      framing: '',
      contributions: [],
      events,
    };
  }

  if (result.status !== 'failed') {
    const reviewNote = result.consolidationReview && !result.consolidationReview.ok
      ? ' La recomendación conserva salvedades: ' + result.consolidationReview.gaps.join(' ')
      : '';
    emit('handoff', 'closed', plan.consolidatorId, null,
      `Recomendación entregada tras ${result.workstreamResults.length} análisis${result.refined ? ', con una corrección' : ''}.${reviewNote}`);
  } else {
    emit('operation-failed', 'closed', null, null, result.consolidation);
  }

  return {
    operationId: result.operationId,
    status: result.status,
    team,
    answer: result.consolidation,
    framing: result.coordination,
    contributions: result.workstreamResults.map((entry) => ({
      personaId: entry.personaId as OfficeAgentId,
      status: entry.status,
      output: entry.output || (entry.error ?? ''),
    })),
    events,
  };
};
