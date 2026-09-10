/**
 * How a coordinated request reaches a persona.
 *
 * `coordinateRequest` is provider-agnostic on purpose: it takes an
 * `OfficeAgentInvoker` and knows nothing about how a persona is actually
 * called. This module is the one adapter the React layer needs, and it exists
 * to solve exactly one mismatch.
 *
 * `geminiService.chatWithProject` is the only entry point that binds a persona
 * explicitly (`personaOverride`) rather than inferring it from the message
 * text — which is what keeps a coordination brief containing an `@Alias` from
 * hijacking the specialist downstream. It takes a `Project`. But the assistant
 * now answers from three levels, and an initiative is not a project and must
 * never be modelled as one.
 *
 * So a request made from an initiative or a deliverable travels inside a
 * **context carrier**: a `Project`-shaped value assembled in memory, holding
 * the record's briefing in `projectContext`, never persisted and never given an
 * id that could collide with a real project. It is a prompt envelope, not a
 * domain object. The alternative — widening `geminiService`, already the
 * largest piece of debt in the repo — would have been a worse trade for the
 * same result.
 */

import type { OfficeAgentInvoker } from './officeOrchestration';
import type { CoordinationScope } from './officeCoordination';
import type { Project, Settings } from '../../types';
import type { ModelTier } from '../../lib/ai/modelCatalog';
import type { OfficeAgentId } from './officeAgentPersonas';

/** Marks a carrier so nothing downstream mistakes it for a stored project. */
export const COORDINATION_CARRIER_PREFIX = 'coordination-carrier:';

export const isCoordinationCarrier = (project: Pick<Project, 'id'>): boolean =>
  project.id.startsWith(COORDINATION_CARRIER_PREFIX);

/**
 * The `Project` value a persona call travels in.
 *
 * When the request comes from a real architecture project, that project *is*
 * the carrier — its artifacts are genuine context the specialists should see.
 * At the other two levels the carrier is synthesised from the scope.
 */
export const carrierForScope = (scope: CoordinationScope, realProject?: Project): Project => {
  if (realProject && scope.level === 'project') return realProject;

  const ancestryLines = (scope.ancestry ?? []).map(
    (ancestor) => `${ancestor.level === 'initiative' ? 'Iniciativa de negocio' : 'Proyecto de arquitectura'}: ${ancestor.name}${ancestor.summary ? ` — ${ancestor.summary}` : ''}`,
  );

  return {
    id: `${COORDINATION_CARRIER_PREFIX}${scope.level}:${scope.id}`,
    name: scope.name,
    description: scope.briefing[0] ?? '',
    projectContext: [...ancestryLines, ...scope.briefing.filter((line) => line.trim().length > 0)],
    // A deliverable's artifacts belong to its project, which the caller passes
    // as `realProject` when it has one. Never invent artifacts here: a
    // specialist that believes an artifact exists will reason about content
    // nobody wrote.
    artifacts: realProject?.artifacts ?? [],
    initiativeIds: scope.level === 'initiative' ? [scope.id] : realProject?.initiativeIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export interface CoordinationInvokerDeps {
  /** `geminiService.chatWithProject`, injected so this module stays testable. */
  chat: (
    project: Project,
    message: string,
    history: { role: 'user' | 'model'; parts: { text: string }[] }[],
    settings: Settings,
    personaOverride?: string,
    modelTier?: ModelTier,
  ) => Promise<string>;
  settings: Settings;
  scope: CoordinationScope;
  /** The real project, when the scope has one behind it. */
  project?: Project;
  /**
   * The model tier each agent is configured to run on.
   *
   * Optional, and absent means "the default for everyone" — which is what the
   * Office did unconditionally before, while the agent's card offered the
   * choice and only assisted capture honoured it. A card that changes how an
   * agent *looks* and not which model answers is decoration.
   */
  modelTiers?: Partial<Record<OfficeAgentId, ModelTier>>;
}

/**
 * Builds the invoker `coordinateRequest` calls once per persona.
 *
 * History is deliberately empty: each persona answers the instruction it was
 * given, and the coordination brief already carries everything it needs. Piping
 * the user's chat history into every specialist would let an aside in an
 * earlier turn silently redirect a workstream.
 */
export const buildCoordinationInvoker = (deps: CoordinationInvokerDeps): OfficeAgentInvoker => {
  const carrier = carrierForScope(deps.scope, deps.project);
  return (personaId, instruction) => deps.chat(
    carrier,
    instruction,
    [],
    deps.settings,
    personaId,
    deps.modelTiers?.[personaId],
  );
};
