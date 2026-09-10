/**
 * The Agent Definition: what an agent *is*, as a contract rather than a record.
 *
 * The thirteen personas were already a good description — role, domains,
 * capabilities, the artifact types they may author and review, the standards
 * they uphold. What they were missing is the half that makes a description
 * enforceable, and the absence had a signature failure: the agent's card
 * offered a model tier and a capacity, the engine read neither, and nothing in
 * the type system noticed. A definition nobody can validate is documentation
 * with a compiler in front of it.
 *
 * So this file holds the shape and the rules, `officeAgentPersonas` holds the
 * thirteen values, and `agentRegistry` is the only way to look one up.
 *
 * **What is deliberately not here**, because the brief asks for it and the
 * product does not yet have anything that would enforce it:
 *
 * - **Tool policy.** There is exactly one tool in the product
 *   (`MODIFY_ARTIFACT_TOOL`). `allowedTools` and `requiresApproval` per agent
 *   would be thirteen records describing a choice nobody can make, which is the
 *   speculative abstraction this repository rules out — and worse, a permission
 *   surface that looks like governance and enforces nothing. It belongs with
 *   the tool registry, when there are tools to register.
 * - **Context policy** (required/forbidden/max context). The context budget is
 *   per call today (`services/ai/callControl`), not per agent, and no caller
 *   can express "this agent must never see the chat history".
 * - **Memory policy** (read/write scopes, TTL). The profile carries a `memory`
 *   list of plain lines; there are no scopes to grant and no TTL to honour.
 *
 * Each of those is a real gap, and naming it here is the point: an empty field
 * on thirteen records would say the work was done.
 */

import type { ArtifactType } from '../../types';
import type { ModelTier } from '../../lib/ai/modelCatalog';

export type OfficeAgentId =
  | 'arky'
  | 'alejandro'
  | 'felipe'
  | 'natalia'
  | 'mauricio'
  | 'ricardo'
  | 'gabriel'
  | 'elena'
  | 'lucia'
  | 'tomas'
  | 'sofia'
  | 'daniel'
  | 'carmen';

/** What an agent is allowed to *do*, as opposed to what it knows about. */
export type OfficeAgentCapability =
  | 'consult'
  | 'generate'
  | 'validate'
  | 'orchestrate'
  | 'consolidate'
  | 'report';

/**
 * The shapes of handoff the Office performs.
 *
 * Here rather than beside either of the two modules that need it — the registry
 * owns the topology (`canHandOff`) and `agentHandoff` owns the envelope — so
 * that neither has to import the other and the vocabulary has one definition.
 */
export type AgentHandoffKind = 'workstream' | 'consolidation';

/** Where an agent stands in an orchestrated operation. */
export type OfficeAgentOrchestrationRole =
  | 'generalist'
  | 'coordinator'
  | 'consolidator'
  | 'participant';

/**
 * What the agent is for, and what it is *not* for.
 *
 * `nonGoals` earns its place by travelling into the prompt: an agent told only
 * what it does will answer anything it is asked, and the failure mode of a
 * thirteen-specialist office is a specialist confidently answering outside its
 * domain because nobody told it where the edge was.
 */
export interface OfficeAgentScope {
  goals: string[];
  nonGoals: string[];
}

export interface OfficeAgentPersona {
  id: OfficeAgentId;
  /**
   * Definition version, bumped when this agent's contract changes.
   *
   * It is stamped onto the resolved profile so a card customised against an
   * older contract is identifiable — an organisation that taught Sofía about
   * its broker channel in v1 should be able to tell that her instruction has
   * been rewritten since.
   */
  version: number;
  alias: string;
  role: string;
  domains: string[];
  scope: OfficeAgentScope;
  capabilities: OfficeAgentCapability[];
  orchestrationRole: OfficeAgentOrchestrationRole;
  instruction: string;
  /**
   * Artifact types this persona may be assigned to *produce*. This is what
   * makes the `generate` capability executable: `OfficeAgentRouter` only
   * assigns a `produce-artifact` task to a persona that declares the type.
   * Empty for personas that never author deliverables (coordinator).
   */
  producesArtifactTypes: ArtifactType[];
  /**
   * Artifact types this persona may *review*. Backs the `validate` capability
   * and the separation-of-duties rule (reviewer !== producer).
   */
  reviewsArtifactTypes: ArtifactType[];
  /** Standard ids from `officeArchitectureKnowledge` this persona must uphold. */
  standardIds: string[];
  /**
   * Default model tier for this agent's work.
   *
   * Every agent resolved to `'default'` regardless of what it does — a
   * regulatory review and a status report asked the same model the same way.
   * The card can still override it; this is what the card overrides *from*.
   */
  modelTier: ModelTier;
  /** Upper bound of tasks the runner may schedule concurrently for this persona. */
  maxConcurrentTasks: number;
}

/**
 * The capabilities that amount to authoring something.
 *
 * `generate` is not the only one, and assuming it was is the first thing this
 * validation caught: Alejandro declares `consolidate` and authors the executive
 * presentation, Tomás declares `report` and authors the status document. Both
 * were flagged as "produces artifacts without declaring `generate`" — a true
 * reading of a rule that was too narrow, not a defect in the roster. The
 * vocabulary has three authoring verbs and the contract has to know all three.
 */
export const AUTHORING_CAPABILITIES: readonly OfficeAgentCapability[] = Object.freeze([
  'generate',
  'consolidate',
  'report',
]);

/** One thing wrong with a definition, in terms a maintainer can act on. */
export interface AgentDefinitionIssue {
  agentId: OfficeAgentId;
  code:
    | 'missing-identity'
    | 'empty-scope'
    | 'capability-without-output'
    | 'output-without-capability'
    | 'reviewer-without-capability'
    | 'participant-cannot-consult'
    | 'coordinator-authors'
    | 'invalid-concurrency'
    | 'invalid-version';
  message: string;
}

/**
 * Check one definition against the rules the engine relies on.
 *
 * Every rule here is one the code already assumes and nothing checked. The two
 * that matter most are the pair in the middle: a persona that declares
 * `generate` and produces nothing can be ranked by the router and then found
 * unable to author anything, and a persona that produces types without
 * declaring `generate` is doing work its own contract says it may not.
 */
export const validateAgentDefinition = (
  definition: OfficeAgentPersona,
): AgentDefinitionIssue[] => {
  const issues: AgentDefinitionIssue[] = [];
  const fail = (code: AgentDefinitionIssue['code'], message: string): void => {
    issues.push({ agentId: definition.id, code, message });
  };

  if (!definition.alias.trim() || !definition.role.trim() || !definition.instruction.trim()) {
    fail('missing-identity', 'Un agente necesita alias, rol e instrucción.');
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    fail('invalid-version', 'La versión del contrato debe ser un entero ≥ 1.');
  }
  if (definition.scope.goals.length === 0) {
    fail('empty-scope', 'Un agente sin objetivos declarados no se puede enrutar ni explicar.');
  }
  if (definition.capabilities.includes('generate') && definition.producesArtifactTypes.length === 0) {
    fail('capability-without-output', 'Declara `generate` pero no puede producir ningún artefacto.');
  }
  const authors = definition.capabilities.some((capability) =>
    AUTHORING_CAPABILITIES.includes(capability));
  if (definition.producesArtifactTypes.length > 0 && !authors) {
    fail(
      'output-without-capability',
      'Produce artefactos sin declarar ninguna capacidad de autoría (generate, consolidate o report).',
    );
  }
  if (definition.reviewsArtifactTypes.length > 0 && !definition.capabilities.includes('validate')) {
    fail('reviewer-without-capability', 'Revisa artefactos sin declarar la capacidad `validate`.');
  }
  if (definition.orchestrationRole === 'participant' && !definition.capabilities.includes('consult')) {
    fail('participant-cannot-consult', 'Un especialista sin `consult` no puede tomar un workstream.');
  }
  // The coordinator plans and hands out work; letting it author a deliverable
  // would put the same agent on both sides of the assignment it just made.
  if (definition.orchestrationRole === 'coordinator' && definition.producesArtifactTypes.length > 0) {
    fail('coordinator-authors', 'El coordinador no puede producir entregables.');
  }
  if (!Number.isInteger(definition.maxConcurrentTasks) || definition.maxConcurrentTasks < 1) {
    fail('invalid-concurrency', 'La capacidad concurrente debe ser un entero ≥ 1.');
  }

  return issues;
};
