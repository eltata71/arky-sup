/**
 * The AgentRegistry: the one place that answers "which agent?".
 *
 * Before this file the question was answered in three: `officeAgentPersonas`
 * held `personasThatProduce` / `personasThatReview`, `OfficeAgentRouter` held
 * `canTakeWorkstream` / `workstreamCapablePersonas`, and any caller that wanted
 * something else read `OFFICE_AGENT_PERSONAS` directly and filtered inline.
 * Three doors onto one table is how the Office ended up with two routing tables
 * that disagreed: nothing said where the answer was supposed to come from.
 *
 * The finders that used to live elsewhere are implemented here and re-exported
 * from their old homes, so call sites did not have to churn to gain a single
 * implementation. `__tests__/architectureOffice/agentRegistry.test.ts` asserts
 * the re-exports are the *same function*, not a second copy that will drift.
 */

import type { ArtifactType } from '../../types';
import {
  validateAgentDefinition,
  type AgentDefinitionIssue,
  type AgentHandoffKind,
  type OfficeAgentCapability,
  type OfficeAgentId,
  type OfficeAgentPersona,
} from './agentDefinition';
import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';

const ALL = (): OfficeAgentPersona[] => Object.values(OFFICE_AGENT_PERSONAS);

/** The agent with this id. Total: every id in the union has a definition. */
export const getAgent = (agentId: OfficeAgentId): OfficeAgentPersona =>
  OFFICE_AGENT_PERSONAS[agentId];

/** Every agent, in registry order. */
export const listAgents = (): OfficeAgentPersona[] => ALL();

/** Agents that declare a capability. */
export const findAgentsByCapability = (
  capability: OfficeAgentCapability,
): OfficeAgentPersona[] => ALL().filter((agent) => agent.capabilities.includes(capability));

/**
 * Agents working in a domain.
 *
 * Matched case-insensitively against the declared domain tags, not against the
 * routing signals: the signals answer "does this sentence smell like AWS", and
 * this answers "whose job is AWS". Conflating them is what let a regex decide
 * who was qualified.
 */
export const findAgentsByDomain = (domain: string): OfficeAgentPersona[] => {
  const needle = domain.trim().toLowerCase();
  if (!needle) return [];
  return ALL().filter((agent) => agent.domains.some((tag) => tag.toLowerCase() === needle));
};

/** Agents that may author the given artifact type. */
export const findAgentsThatProduce = (type: ArtifactType): OfficeAgentPersona[] =>
  ALL().filter((agent) => agent.producesArtifactTypes.includes(type));

/** Agents that may review the given artifact type. */
export const findAgentsThatReview = (type: ArtifactType): OfficeAgentPersona[] =>
  ALL().filter((agent) => agent.reviewsArtifactTypes.includes(type));

/** True when this agent may be given a coordination workstream. */
export const canTakeWorkstream = (agent: OfficeAgentPersona): boolean =>
  agent.orchestrationRole === 'participant' && agent.capabilities.includes('consult');

/** Every agent that may be given a coordination workstream, registry order. */
export const workstreamCapableAgents = (): OfficeAgentPersona[] => ALL().filter(canTakeWorkstream);

/**
 * May `source` hand work to `target`, for this kind of handoff?
 *
 * The topology is derived from the roles rather than listed per agent, because
 * it *is* the roles: the coordinator hands workstreams to specialists, then
 * hands the assembled results to the consolidator, who reads them and signs. A
 * specialist answers its own workstream and hands nothing on. Writing
 * `delegatesTo` on thirteen records would be the same fact stated thirteen
 * times, and the fourteenth agent would be the one that got it wrong.
 *
 * Two rules with teeth: **nobody hands work to themselves** — the separation of
 * duties the whole review loop rests on, expressed for delegation — and a
 * specialist hands nothing on, which is what keeps the depth of an operation at
 * one and makes "maxDelegations" a property of the shape rather than a counter
 * somebody has to enforce.
 */
export const canHandOff = (
  source: OfficeAgentId,
  target: OfficeAgentId,
  kind: AgentHandoffKind = 'workstream',
): boolean => {
  if (source === target) return false;
  const from = getAgent(source);
  const to = getAgent(target);
  // Only the coordinator hands work on, whichever kind it is.
  if (from.orchestrationRole !== 'coordinator') return false;
  if (!from.capabilities.includes('orchestrate')) return false;
  return kind === 'workstream'
    ? canTakeWorkstream(to)
    : to.orchestrationRole === 'consolidator' && to.capabilities.includes('consolidate');
};

/** May `source` give `target` a workstream? The commonest handoff, named. */
export const canDelegate = (source: OfficeAgentId, target: OfficeAgentId): boolean =>
  canHandOff(source, target, 'workstream');

/** Who this agent may hand work to, in registry order. */
export const delegationTargets = (source: OfficeAgentId): OfficeAgentPersona[] =>
  ALL().filter((agent) => canDelegate(source, agent.id));

/** Check one definition. Re-exported so a caller never reaches past the registry. */
export { validateAgentDefinition };

/**
 * Check the whole roster, including the rules that are about the *set* rather
 * than about one agent.
 *
 * The cross-agent rules are the ones a per-definition check cannot see: an
 * artifact type somebody can author and nobody can review would produce a
 * charter whose review task has no eligible assignee, and an office with no
 * coordinator or no consolidator cannot run an operation at all.
 */
export const validateAgentRegistry = (): AgentDefinitionIssue[] => {
  const issues = ALL().flatMap(validateAgentDefinition);

  const byRole = (role: OfficeAgentPersona['orchestrationRole']): number =>
    ALL().filter((agent) => agent.orchestrationRole === role).length;
  for (const role of ['coordinator', 'consolidator'] as const) {
    if (byRole(role) !== 1) {
      issues.push({
        agentId: 'arky',
        code: 'missing-identity',
        message: `La Oficina necesita exactamente un agente con el rol ${role}; hay ${byRole(role)}.`,
      });
    }
  }

  const producible = new Set(ALL().flatMap((agent) => agent.producesArtifactTypes));
  for (const type of producible) {
    const reviewers = findAgentsThatReview(type);
    const producers = findAgentsThatProduce(type);
    // Separation of duties needs a reviewer who is not the only producer.
    const independent = reviewers.filter(
      (reviewer) => producers.length > 1 || producers[0]?.id !== reviewer.id,
    );
    if (independent.length === 0) {
      issues.push({
        agentId: producers[0]?.id ?? 'arky',
        code: 'reviewer-without-capability',
        message: `Nadie independiente puede revisar "${type}", que sí se puede producir.`,
      });
    }
  }

  return issues;
};

/** The agent registry as one object, for callers that prefer a namespace. */
export const agentRegistry = {
  get: getAgent,
  list: listAgents,
  findByCapability: findAgentsByCapability,
  findByDomain: findAgentsByDomain,
  findThatProduce: findAgentsThatProduce,
  findThatReview: findAgentsThatReview,
  canTakeWorkstream,
  workstreamCapable: workstreamCapableAgents,
  canDelegate,
  canHandOff,
  delegationTargets,
  validateDefinition: validateAgentDefinition,
  validate: validateAgentRegistry,
} as const;
